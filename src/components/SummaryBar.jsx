import React from 'react'

const CATEGORY_LABELS = {
  labor: '人工费',
  material: '材料费',
  equipment: '设备费',
  rental: '机械租赁费',
}

const CATEGORY_COLORS = {
  labor: '#3b82f6',
  material: '#10b981',
  equipment: '#f59e0b',
  rental: '#8b5cf6',
}

export default function SummaryBar({ summary }) {
  if (!summary || !summary.total) return null

  const { byCategory, total } = summary
  const totalCost = total.total_cost || 0

  return (
    <div className="summary-bar">
      <div className="summary-total">
        <span className="summary-label">项目总计</span>
        <span className="summary-value">¥{totalCost.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
        <span className="summary-detail">{total.count} 条明细 · {(total.total_hours || 0).toFixed(1)} 工时</span>
      </div>
      <div className="summary-categories">
        {byCategory.map((cat) => (
          <div key={cat.category} className="summary-cat">
            <span
              className="cat-dot"
              style={{ backgroundColor: CATEGORY_COLORS[cat.category] || '#999' }}
            />
            <span className="cat-name">{CATEGORY_LABELS[cat.category] || cat.category}</span>
            <span className="cat-value">
              ¥{(cat.total_cost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
            </span>
            {totalCost > 0 && (
              <span className="cat-percent">
                {((cat.total_cost / totalCost) * 100).toFixed(1)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
