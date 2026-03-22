import React, { useState, useEffect, useCallback } from 'react'
import EditableCell from './EditableCell'

const CATEGORY_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'labor', label: '人工费' },
  { value: 'material', label: '材料费' },
  { value: 'equipment', label: '设备费' },
  { value: 'rental', label: '机械租赁费' },
]

const CATEGORY_LABELS = {
  labor: '人工费',
  material: '材料费',
  equipment: '设备费',
  rental: '机械租赁费',
}

export default function QuotaLibrary({ onApply, onClose }) {
  const [items, setItems] = useState([])
  const [filterCategory, setFilterCategory] = useState('')
  const [searchText, setSearchText] = useState('')
  const [pdfPreview, setPdfPreview] = useState(null)  // PDF 预览数据
  const [pdfImporting, setPdfImporting] = useState(false)

  const loadItems = useCallback(async () => {
    const list = await window.api.listQuota(filterCategory || undefined)
    setItems(list)
  }, [filterCategory])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  const handleCreate = async () => {
    await window.api.createQuota({
      category: filterCategory || 'material',
      name: '新定额项',
      unit: '',
      unit_price: 0,
    })
    loadItems()
  }

  const handleUpdate = async (id, field, value) => {
    await window.api.updateQuota(id, { [field]: value })
    loadItems()
  }

  const handleSeed = async () => {
    const result = await window.api.seedQuota()
    if (result.seeded) {
      const parts = [`成功加载 ${result.inserted} 条预设定额`]
      if (result.skipped > 0) {
        parts.push(`跳过 ${result.skipped} 条已存在的数据`)
      }
      alert(parts.join('\n'))
      loadItems()
    } else {
      alert('预设数据已全部存在，无新增数据')
    }
  }

  const handleImport = async (clearExisting = false) => {
    const result = await window.api.importQuota({ clearExisting })
    if (result.canceled) return
    if (result.success) {
      const parts = [`成功导入 ${result.inserted} 条定额数据`]
      if (result.skipped > 0) {
        parts.push(`跳过 ${result.skipped} 条重复数据（按"类别+名称+规格"判断）`)
      }
      alert(parts.join('\n'))
      loadItems()
    } else {
      alert('导入失败：' + result.error)
    }
  }

  // PDF 定额预览
  const handlePdfPreview = async () => {
    setPdfImporting(true)
    try {
      const result = await window.api.previewPdfQuota()
      if (result.canceled) { setPdfImporting(false); return }
      if (result.success) {
        setPdfPreview(result)
      } else {
        alert('PDF 解析失败：' + result.error)
      }
    } catch (err) {
      alert('PDF 解析出错：' + err.message)
    }
    setPdfImporting(false)
  }

  // 确认导入 PDF 预览的数据
  const handlePdfConfirmImport = async (clearExisting = false) => {
    if (!pdfPreview?.items?.length) return
    try {
      const result = await window.api.importQuota({
        clearExisting,
        items: pdfPreview.items,
      })
      if (result.success) {
        const parts = [`成功导入 ${result.inserted} 条定额数据`]
        if (result.skipped > 0) {
          parts.push(`跳过 ${result.skipped} 条重复数据`)
        }
        alert(parts.join('\n'))
        setPdfPreview(null)
        loadItems()
      } else {
        alert('导入失败：' + result.error)
      }
    } catch (err) {
      alert('导入出错：' + err.message)
    }
  }

  const handleDelete = async (id) => {
    if (confirm('确定删除此定额项？')) {
      await window.api.deleteQuota(id)
      loadItems()
    }
  }

  const handleApply = (item) => {
    if (onApply) {
      onApply({
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        unit_price: item.unit_price,
        work_hours: item.work_hours,
        category: item.category,
      })
    }
  }

  const filtered = items.filter((item) => {
    if (!searchText) return true
    return item.name.includes(searchText) || (item.spec || '').includes(searchText)
  })

  return (
    <div className="quota-library-overlay" onClick={onClose}>
      <div className="quota-library-panel" onClick={(e) => e.stopPropagation()}>
        <div className="quota-header">
          <h2>定额库</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="quota-toolbar">
          <div className="quota-filters">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`filter-chip ${filterCategory === opt.value ? 'active' : ''}`}
                onClick={() => setFilterCategory(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            className="quota-search"
            type="text"
            placeholder="搜索名称或规格..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <button className="btn btn-primary btn-sm-action" onClick={handleCreate}>
            + 新增定额
          </button>
          <button
            className="btn btn-sm-action"
            onClick={handleSeed}
            title="加载管道/机电安装行业常用预设定额（自动跳过已存在项）"
          >
            加载预设
          </button>
          <button
            className="btn btn-sm-action"
            onClick={() => handleImport(false)}
            title="从 Excel/CSV/PDF 文件追加导入定额数据（自动跳过重复项）"
          >
            导入数据
          </button>
          <button
            className="btn btn-sm-action btn-pdf"
            onClick={handlePdfPreview}
            disabled={pdfImporting}
            title="从标准定额 PDF 文件解析并预览后导入（支持多选）"
          >
            {pdfImporting ? '解析中...' : 'PDF定额导入'}
          </button>
          <button
            className="btn btn-sm-action btn-warning"
            onClick={() => {
              if (confirm('覆盖导入将清空现有定额库数据，确定继续？')) {
                handleImport(true)
              }
            }}
            title="清空现有数据后导入"
          >
            覆盖导入
          </button>
        </div>

        <div className="quota-table-wrapper">
          <table className="quota-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>费用类别</th>
                <th style={{ width: 180 }}>名称</th>
                <th style={{ width: 100 }}>规格型号</th>
                <th style={{ width: 60 }}>单位</th>
                <th style={{ width: 90 }}>单价</th>
                <th style={{ width: 70 }}>工时</th>
                <th style={{ width: 120 }}>备注</th>
                <th style={{ width: 100 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <select
                      value={item.category}
                      onChange={(e) => handleUpdate(item.id, 'category', e.target.value)}
                      className="category-select"
                    >
                      {CATEGORY_OPTIONS.filter((o) => o.value).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <EditableCell
                      value={item.name}
                      onSave={(v) => handleUpdate(item.id, 'name', v)}
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={item.spec}
                      onSave={(v) => handleUpdate(item.id, 'spec', v)}
                      placeholder="规格"
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={item.unit}
                      onSave={(v) => handleUpdate(item.id, 'unit', v)}
                      placeholder="单位"
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={item.unit_price}
                      type="number"
                      onSave={(v) => handleUpdate(item.id, 'unit_price', parseFloat(v) || 0)}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={item.work_hours}
                      type="number"
                      onSave={(v) => handleUpdate(item.id, 'work_hours', parseFloat(v) || 0)}
                      placeholder="0"
                    />
                  </td>
                  <td>
                    <EditableCell
                      value={item.remark}
                      onSave={(v) => handleUpdate(item.id, 'remark', v)}
                      placeholder=""
                    />
                  </td>
                  <td className="quota-actions">
                    {onApply && (
                      <button
                        className="btn-icon btn-apply"
                        onClick={() => handleApply(item)}
                        title="应用到当前明细"
                      >
                        引用
                      </button>
                    )}
                    <button
                      className="btn-icon btn-del"
                      onClick={() => handleDelete(item.id)}
                      title="删除"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    {searchText ? '没有匹配的定额项' : '暂无定额数据，点击"新增定额"添加'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="quota-footer">
          <span className="quota-count">共 {filtered.length} 条</span>
        </div>

        {/* PDF 预览弹窗 */}
        {pdfPreview && (
          <div className="pdf-preview-overlay" onClick={() => setPdfPreview(null)}>
            <div className="pdf-preview-panel" onClick={(e) => e.stopPropagation()}>
              <div className="pdf-preview-header">
                <h3>PDF 定额解析结果</h3>
                <button className="btn-close" onClick={() => setPdfPreview(null)}>✕</button>
              </div>

              <div className="pdf-preview-stats">
                <span>解析 {pdfPreview.totalFiles} 个文件，共 {pdfPreview.totalPages} 页</span>
                <span style={{ marginLeft: 16 }}>提取到 <strong>{pdfPreview.items.length}</strong> 条资源定额</span>
                {pdfPreview.sections.length > 0 && (
                  <span style={{ marginLeft: 16 }}>
                    定额子目：{pdfPreview.sections.map(s => s.title).join('、')}
                  </span>
                )}
              </div>

              <div className="pdf-preview-table-wrapper">
                <table className="quota-table">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>类别</th>
                      <th style={{ width: 160 }}>名称</th>
                      <th style={{ width: 120 }}>规格型号</th>
                      <th style={{ width: 50 }}>单位</th>
                      <th style={{ width: 80 }}>单价(元)</th>
                      <th style={{ width: 150 }}>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdfPreview.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{CATEGORY_LABELS[item.category] || item.category}</td>
                        <td>{item.name}</td>
                        <td>{item.spec}</td>
                        <td>{item.unit}</td>
                        <td>{item.unit_price.toFixed(2)}</td>
                        <td>{item.remark}</td>
                      </tr>
                    ))}
                    {pdfPreview.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          未解析到有效定额数据，请确认 PDF 为标准定额编制文件
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pdf-preview-footer">
                <button
                  className="btn btn-sm-action"
                  onClick={() => setPdfPreview(null)}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary btn-sm-action"
                  onClick={() => handlePdfConfirmImport(false)}
                  disabled={!pdfPreview.items.length}
                >
                  追加导入 ({pdfPreview.items.length} 条)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
