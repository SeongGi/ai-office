'use strict';
// 선택 화면(choose.html)이 쓰는 최소한의 통로. sandbox 안에서 돌아야 하므로 electron 모듈만 쓴다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiOffice', {
  current: () => ipcRenderer.invoke('choice:current'),
  choose: (c) => ipcRenderer.invoke('choice:save', c),
});
