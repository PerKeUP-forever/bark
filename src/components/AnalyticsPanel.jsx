import React, { useState, useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

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

const DIVISION_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
  '#6366f1', '#84cc16',
]

export default function AnalyticsPanel({ projectId, summary, onClose }) {
  const [analytics, setAnalytics] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const pieRef = useRef(null)
  const barRef = useRef(null)
  const pieChartRef = useRef(null)
  const barChartRef = useRef(null)

  useEffect(() => {
    if (projectId) {
      window.api.getAnalytics(projectId).then(setAnalytics)
    }
  }, [projectId])

  // 费用类别饼图
  useEffect(() => {
    if (!summary?.byCategory?.length || !pieRef.current) return
    if (pieChartRef.current) pieChartRef.current.destroy()

    pieChartRef.current = new Chart(pieRef.current, {
      type: 'doughnut',
      data: {
        labels: summary.byCategory.map((c) => CATEGORY_LABELS[c.category] || c.category),
        datasets: [{
          data: summary.byCategory.map((c) => c.total_cost || 0),
          backgroundColor: summary.byCategory.map((c) => CATEGORY_COLORS[c.category] || '#999'),
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0
                return `${ctx.label}: ¥${ctx.raw.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} (${pct}%)`
              },
            },
          },
        },
      },
    })

    return () => { if (pieChartRef.current) pieChartRef.current.destroy() }
  }, [summary])

  // 分部工程柱状图
  useEffect(() => {
    if (!analytics?.byDivision?.length || !barRef.current) return
    if (barChartRef.current) barChartRef.current.destroy()

    barChartRef.current = new Chart(barRef.current, {
      type: 'bar',
      data: {
        labels: analytics.byDivision.map((d) => d.name),
        datasets: [{
          label: '金额',
          data: analytics.byDivision.map((d) => d.total_cost || 0),
          backgroundColor: analytics.byDivision.map((_, i) => DIVISION_COLORS[i % DIVISION_COLORS.length]),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `¥${ctx.raw.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => `¥${(v / 10000).toFixed(0)}万`,
            },
          },
        },
      },
    })

    return () => { if (barChartRef.current) barChartRef.current.destroy() }
  }, [analytics])

  if (!summary) return null

  const totalCost = summary.total?.total_cost || 0

  return (
    <div className="analytics-overlay" onClick={onClose}>
      <div className="analytics-panel" onClick={(e) => e.stopPropagation()}>
        <div className="analytics-header">
          <h2>数据分析</h2>
          <div className="analytics-tabs">
            <button
              className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              总览
            </button>
            <button
              className={`tab-btn ${activeTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              明细排行
            </button>
          </div>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {activeTab === 'overview' && (
          <div className="analytics-content">
            <div className="analytics-cards">
              <div className="stat-card">
                <div className="stat-label">项目总造价</div>
                <div className="stat-value primary">
                  ¥{totalCost.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">明细条目</div>
                <div className="stat-value">{summary.total?.count || 0}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">总工时</div>
                <div className="stat-value">{(summary.total?.total_hours || 0).toFixed(1)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">分部工程数</div>
                <div className="stat-value">{analytics?.byDivision?.length || 0}</div>
              </div>
            </div>

            <div className="chart-row">
              <div className="chart-card">
                <h3>费用类别构成</h3>
                <div className="chart-container">
                  <canvas ref={pieRef} />
                </div>
              </div>
              <div className="chart-card">
                <h3>分部工程对比</h3>
                <div className="chart-container">
                  <canvas ref={barRef} />
                </div>
              </div>
            </div>

            {analytics?.byDivision?.length > 0 && (
              <div className="division-table-card">
                <h3>分部工程明细</h3>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th>分部工程</th>
                      <th>明细数</th>
                      <th>金额</th>
                      <th>占比</th>
                      <th>工时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byDivision.map((d, i) => (
                      <tr key={d.id}>
                        <td>
                          <span className="div-dot" style={{ backgroundColor: DIVISION_COLORS[i % DIVISION_COLORS.length] }} />
                          {d.name}
                        </td>
                        <td>{d.item_count || 0}</td>
                        <td className="num">¥{(d.total_cost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                        <td className="num">{totalCost > 0 ? ((d.total_cost / totalCost) * 100).toFixed(1) + '%' : '-'}</td>
                        <td className="num">{(d.total_hours || 0).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'details' && analytics?.topExpensive?.length > 0 && (
          <div className="analytics-content">
            <div className="division-table-card">
              <h3>金额排行 Top 10</h3>
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>名称</th>
                    <th>规格</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>金额</th>
                    <th>类别</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.topExpensive.map((item, i) => (
                    <tr key={i}>
                      <td className="rank-cell">
                        <span className={`rank-badge ${i < 3 ? 'top3' : ''}`}>{i + 1}</span>
                      </td>
                      <td>{item.name}</td>
                      <td>{item.spec || '-'}</td>
                      <td className="num">{item.quantity} {item.unit}</td>
                      <td className="num">¥{(item.unit_price || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="num amount-cell">¥{(item.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td>{CATEGORY_LABELS[item.category] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
