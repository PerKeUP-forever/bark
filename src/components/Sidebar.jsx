import React, { useState } from 'react'

export default function Sidebar({ projects, activeProject, onSelect, onCreate, onDelete, onRename }) {
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const startRename = (project) => {
    setEditingId(project.id)
    setEditName(project.name)
  }

  const commitRename = () => {
    if (editName.trim() && editingId) {
      onRename(editingId, editName.trim())
    }
    setEditingId(null)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>项目列表</h2>
        <button className="btn btn-sm" onClick={onCreate} title="新建项目">＋</button>
      </div>
      <div className="project-list">
        {projects.map((p) => (
          <div
            key={p.id}
            className={`project-item ${activeProject?.id === p.id ? 'active' : ''}`}
            onClick={() => onSelect(p)}
          >
            {editingId === p.id ? (
              <input
                className="rename-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="project-name">{p.name}</span>
                <div className="project-actions">
                  <button
                    className="btn-icon"
                    title="重命名"
                    onClick={(e) => { e.stopPropagation(); startRename(p) }}
                  >✏️</button>
                  <button
                    className="btn-icon"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`确定删除项目「${p.name}」？所有数据将丢失。`)) {
                        onDelete(p.id)
                      }
                    }}
                  >🗑️</button>
                </div>
              </>
            )}
          </div>
        ))}
        {projects.length === 0 && (
          <div className="empty-hint">暂无项目，点击上方 ＋ 创建</div>
        )}
      </div>
    </div>
  )
}
