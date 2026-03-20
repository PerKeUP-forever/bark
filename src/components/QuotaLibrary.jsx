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

  const handleImport = async (clearExisting = false) => {
    const result = await window.api.importQuota({ clearExisting })
    if (result.canceled) return
    if (result.success) {
      alert(`成功导入 ${result.count} 条定额数据`)
      loadItems()
    } else {
      alert('导入失败：' + result.error)
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
            onClick={() => handleImport(false)}
            title="从 Excel 文件追加导入定额数据"
          >
            导入 Excel
          </button>
          <button
            className="btn btn-sm-action btn-warning"
            onClick={() => {
              if (confirm('覆盖导入将清空现有定额库数据，确定继续？')) {
                handleImport(true)
              }
            }}
            title="清空现有数据后从 Excel 导入"
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
      </div>
    </div>
  )
}
