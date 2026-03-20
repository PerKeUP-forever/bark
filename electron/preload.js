const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 项目操作
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (name, description) => ipcRenderer.invoke('project:create', name, description),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  renameProject: (id, name) => ipcRenderer.invoke('project:rename', id, name),

  // 预算项操作
  listItems: (projectId) => ipcRenderer.invoke('item:list', projectId),
  createItem: (item) => ipcRenderer.invoke('item:create', item),
  updateItem: (id, fields) => ipcRenderer.invoke('item:update', id, fields),
  deleteItem: (id) => ipcRenderer.invoke('item:delete', id),
  reorderItems: (items) => ipcRenderer.invoke('item:reorder', items),

  // 汇总统计
  getSummary: (projectId) => ipcRenderer.invoke('summary:get', projectId),

  // 定额库
  listQuota: (category) => ipcRenderer.invoke('quota:list', category),
  createQuota: (item) => ipcRenderer.invoke('quota:create', item),
  updateQuota: (id, fields) => ipcRenderer.invoke('quota:update', id, fields),
  deleteQuota: (id) => ipcRenderer.invoke('quota:delete', id),
  importQuota: (options) => ipcRenderer.invoke('quota:import', options),
  seedQuota: () => ipcRenderer.invoke('quota:seed'),

  // 导出
  exportExcel: (projectId) => ipcRenderer.invoke('export:excel', projectId),
  exportPdf: (projectId) => ipcRenderer.invoke('export:pdf', projectId),

  // 导入
  importExcel: (projectId) => ipcRenderer.invoke('import:excel', projectId),

  // 数据分析
  getAnalytics: (projectId) => ipcRenderer.invoke('analytics:get', projectId),
})
