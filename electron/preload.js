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
})
