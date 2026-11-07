// test/ui.test.mjs가 번들하는 진입점이다. 캔버스와 DOM에 닿지 않는 화면 코드(스토어, 라벨, 색, 2D 카메라)만 모은다.
export { store } from '../../src/core/store';
export { STATUS_LABEL_KO, PILL_KO, pillDetail } from '../../src/ui/labels';
export { mix, lighten, darken, rgba, hsl, rgb } from '../../src/world2d/color';
export { Camera2D, MIN_ZOOM, MAX_ZOOM, BASE_PX } from '../../src/world2d/camera';
