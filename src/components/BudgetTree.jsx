import React, { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import EditableCell from './EditableCell'

const LEVEL_LABELS = ['分部工程', '分项工程', '明细']
const CATEGORY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'labor', label: '人工费' },
  { value: 'material', label: '材料费' },
  { value: 'equipment', label: '设备费' },
  { value: 'rental', label: '机械租赁费' },
]

// 可拖拽的行组件
function SortableRow({ item, depth, projectId, onRefresh }) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = item.children && item.children.length > 0
  const isDetail = item.level === 2
  const amount = (item.quantity || 0) * (item.unit_price || 0)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id.toString() })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleUpdate = async (field, value) => {
    await window.api.updateItem(item.id, { [field]: value })
    onRefresh()
  }

  const handleAddChild = async () => {
    const childLevel = item.level + 1
    if (childLevel > 2) return
    await window.api.createItem({
      project_id: projectId,
      parent_id: item.id,
      name: childLevel === 1 ? '新分项工程' : '新明细',
      level: childLevel,
    })
    setExpanded(true)
    onRefresh()
  }

  const handleDelete = async () => {
    const label = LEVEL_LABELS[item.level] || '项目'
    if (confirm(`确定删除「${item.name}」？${hasChildren ? '所有子项也会被删除。' : ''}`)) {
      await window.api.deleteItem(item.id)
      onRefresh()
    }
  }

  // 获取所有子项 ID（用于 sortable context）
  const childIds = (item.children || []).map((c) => c.id.toString())

  return (
    <>
      <tr ref={setNodeRef} style={style} className={`row-level-${item.level} ${isDragging ? 'dragging' : ''}`}>
        {/* 拖拽手柄 */}
        <td className="cell-handle" {...attributes} {...listeners}>
          ⠿
        </td>

        {/* 名称（带缩进和展开按钮） */}
        <td className="cell-name">
          <div style={{ paddingLeft: depth * 20 }} className="name-content">
            {hasChildren ? (
              <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="expand-placeholder" />
            )}
            <span className="level-tag">{LEVEL_LABELS[item.level]}</span>
            <EditableCell
              value={item.name}
              onSave={(v) => handleUpdate('name', v)}
              className="name-input"
            />
          </div>
        </td>

        {/* 费用类别（仅明细级别） */}
        <td className="cell-category">
          {isDetail ? (
            <select
              value={item.category || ''}
              onChange={(e) => handleUpdate('category', e.target.value)}
              className="category-select"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : null}
        </td>

        {/* 规格型号 */}
        <td className="cell-spec">
          {isDetail && (
            <EditableCell value={item.spec} onSave={(v) => handleUpdate('spec', v)} placeholder="规格" />
          )}
        </td>

        {/* 单位 */}
        <td className="cell-unit">
          {isDetail && (
            <EditableCell value={item.unit} onSave={(v) => handleUpdate('unit', v)} placeholder="单位" />
          )}
        </td>

        {/* 数量 */}
        <td className="cell-number">
          {isDetail && (
            <EditableCell
              value={item.quantity}
              type="number"
              onSave={(v) => handleUpdate('quantity', parseFloat(v) || 0)}
              placeholder="0"
            />
          )}
        </td>

        {/* 单价 */}
        <td className="cell-number">
          {isDetail && (
            <EditableCell
              value={item.unit_price}
              type="number"
              onSave={(v) => handleUpdate('unit_price', parseFloat(v) || 0)}
              placeholder="0.00"
            />
          )}
        </td>

        {/* 金额（自动计算） */}
        <td className="cell-amount">
          {isDetail ? (
            <span className="amount">{amount > 0 ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : ''}</span>
          ) : (
            <SubtotalDisplay item={item} />
          )}
        </td>

        {/* 工时 */}
        <td className="cell-number">
          {isDetail && (
            <EditableCell
              value={item.work_hours}
              type="number"
              onSave={(v) => handleUpdate('work_hours', parseFloat(v) || 0)}
              placeholder="0"
            />
          )}
        </td>

        {/* 备注 */}
        <td className="cell-remark">
          <EditableCell value={item.remark} onSave={(v) => handleUpdate('remark', v)} placeholder="" />
        </td>

        {/* 操作 */}
        <td className="cell-actions">
          {item.level < 2 && (
            <button className="btn-icon btn-add" onClick={handleAddChild} title={`添加${LEVEL_LABELS[item.level + 1]}`}>
              ＋
            </button>
          )}
          <button className="btn-icon btn-del" onClick={handleDelete} title="删除">
            ✕
          </button>
        </td>
      </tr>

      {/* 递归渲染子节点 */}
      {expanded && hasChildren && (
        <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
          {item.children.map((child) => (
            <SortableRow
              key={child.id}
              item={child}
              depth={depth + 1}
              projectId={projectId}
              onRefresh={onRefresh}
            />
          ))}
        </SortableContext>
      )}
    </>
  )
}

// 小计显示（递归计算子项金额）
function SubtotalDisplay({ item }) {
  const calcSubtotal = (node) => {
    if (node.level === 2) return (node.quantity || 0) * (node.unit_price || 0)
    return (node.children || []).reduce((sum, child) => sum + calcSubtotal(child), 0)
  }
  const subtotal = calcSubtotal(item)
  if (subtotal <= 0) return null
  return (
    <span className="subtotal">
      小计 ¥{subtotal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
    </span>
  )
}

// 主组件
export default function BudgetTree({ tree, projectId, onRefresh }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = async (event) => {
    const { active, over } = event
    if (!active || !over || active.id === over.id) return

    // 收集所有扁平化的节点，找到 active 和 over 的位置
    const flattenTree = (nodes, parentId = null) => {
      const result = []
      nodes.forEach((node) => {
        result.push({ id: node.id, parent_id: parentId, level: node.level })
        if (node.children) {
          result.push(...flattenTree(node.children, node.id))
        }
      })
      return result
    }

    const flat = flattenTree(tree)
    const activeIdx = flat.findIndex((n) => n.id.toString() === active.id)
    const overIdx = flat.findIndex((n) => n.id.toString() === over.id)

    if (activeIdx === -1 || overIdx === -1) return

    const activeItem = flat[activeIdx]
    const overItem = flat[overIdx]

    // 只允许同级别拖拽
    if (activeItem.level !== overItem.level) return

    // 重新排序同父级的兄弟节点
    const siblings = flat.filter(
      (n) => n.level === activeItem.level && n.parent_id === overItem.parent_id
    )

    // 将 active 移到 over 的位置
    const reordered = siblings.filter((n) => n.id !== activeItem.id)
    const overSiblingIdx = reordered.findIndex((n) => n.id === overItem.id)
    reordered.splice(overSiblingIdx + (activeIdx > overIdx ? 0 : 1), 0, {
      ...activeItem,
      parent_id: overItem.parent_id,
    })

    const updates = reordered.map((n, i) => ({
      id: n.id,
      sort_order: i,
      parent_id: n.parent_id,
    }))

    await window.api.reorderItems(updates)
    onRefresh()
  }

  const handleAddDivision = async () => {
    await window.api.createItem({
      project_id: projectId,
      parent_id: null,
      name: '新分部工程',
      level: 0,
    })
    onRefresh()
  }

  const rootIds = tree.map((n) => n.id.toString())

  return (
    <div className="budget-tree">
      <div className="table-wrapper">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="budget-table">
            <thead>
              <tr>
                <th className="th-handle"></th>
                <th className="th-name">名称</th>
                <th className="th-category">费用类别</th>
                <th className="th-spec">规格型号</th>
                <th className="th-unit">单位</th>
                <th className="th-number">数量</th>
                <th className="th-number">单价</th>
                <th className="th-amount">金额</th>
                <th className="th-number">工时</th>
                <th className="th-remark">备注</th>
                <th className="th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
                {tree.map((node) => (
                  <SortableRow
                    key={node.id}
                    item={node}
                    depth={0}
                    projectId={projectId}
                    onRefresh={onRefresh}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </DndContext>
      </div>
      <button className="btn btn-dashed add-division-btn" onClick={handleAddDivision}>
        ＋ 添加分部工程
      </button>
    </div>
  )
}
