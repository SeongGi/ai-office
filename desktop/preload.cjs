'use strict';
// 선택 화면(choose.html)이 쓰는 최소한의 통로. sandbox 안에서 돌아야 하므로 electron 모듈만 쓴다.
const { contextBridge, ipcRenderer } = require('electron');

// 서버 페이지(원격 포함)에는 이 통로를 아예 열지 않는다. main.cjs도 보낸 쪽을 한 번 더 확인한다.
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('aiOffice', {
  current: () => ipcRenderer.invoke('choice:current'),
  choose: (c) => ipcRenderer.invoke('choice:save', c),
  cancel: () => ipcRenderer.invoke('choice:cancel'),
});
