import React, { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import BudgetTree from './components/BudgetTree'
import SummaryBar from './components/SummaryBar'

export default function App() {
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    const list = await window.api.listProjects()
    setProjects(list)
  }, [])

  // 加载预算项
  const loadItems = useCallback(async (projectId) => {
    if (!projectId) return
    const list = await window.api.listItems(projectId)
    setItems(list)
    const sum = await window.api.getSummary(projectId)
    setSummary(sum)
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (activeProject) {
      loadItems(activeProject.id)
    } else {
      setItems([])
      setSummary(null)
    }
  }, [activeProject, loadItems])

  const refresh = () => {
    if (activeProject) loadItems(activeProject.id)
  }

  // 创建新项目
  const handleCreateProject = async () => {
    const project = await window.api.createProject('新项目')
    await loadProjects()
    setActiveProject(project)
  }

  // 删除项目
  const handleDeleteProject = async (id) => {
    await window.api.deleteProject(id)
    if (activeProject?.id === id) {
      setActiveProject(null)
    }
    await loadProjects()
  }

  // 重命名项目
  const handleRenameProject = async (id, name) => {
    const updated = await window.api.renameProject(id, name)
    await loadProjects()
    if (activeProject?.id === id) setActiveProject(updated)
  }

  // 构建树形结构
  const buildTree = (flatItems) => {
    const map = {}
    const roots = []
    flatItems.forEach((item) => {
      map[item.id] = { ...item, children: [] }
    })
    flatItems.forEach((item) => {
      if (item.parent_id && map[item.parent_id]) {
        map[item.parent_id].children.push(map[item.id])
      } else {
        roots.push(map[item.id])
      }
    })
    // 按 sort_order 排序
    const sortChildren = (nodes) => {
      nodes.sort((a, b) => a.sort_order - b.sort_order)
      nodes.forEach((n) => sortChildren(n.children))
    }
    sortChildren(roots)
    return roots
  }

  const tree = buildTree(items)

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        activeProject={activeProject}
        onSelect={setActiveProject}
        onCreate={handleCreateProject}
        onDelete={handleDeleteProject}
        onRename={handleRenameProject}
      />
      <div className="main-area">
        {activeProject ? (
          <>
            <div className="main-header">
              <h1>{activeProject.name}</h1>
              <span className="project-desc">{activeProject.description}</span>
            </div>
            <SummaryBar summary={summary} />
            <BudgetTree
              tree={tree}
              projectId={activeProject.id}
              onRefresh={refresh}
            />
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h2>选择或创建一个项目</h2>
            <p>从左侧选择已有项目，或点击"新建项目"开始</p>
            <button className="btn btn-primary" onClick={handleCreateProject}>
              新建项目
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
