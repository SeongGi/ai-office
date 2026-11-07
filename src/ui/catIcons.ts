// 방 카드에 쓰는 손그림 고양이 아이콘이다. 방마다 고양이가 하는 일이 다르다.
// 모두 32x32 격자에 선만으로 그리며, 색은 currentColor를 따른다.
import type { GuidePlace } from '../../shared/sidepanel';

// 고양이 머리: 귀 두 개, 눈 두 개, 코 하나다. 머리 아래쪽 여백(세로 22~31)에 소품을 놓는다.
const HEAD =
  '<path d="M7 13V4.5L13 8q3-.7 6 0l6-3.5V13q0 7-9 7t-9-7z"/>' +
  '<circle cx="12" cy="13" r="1" fill="currentColor" stroke="none"/>' +
  '<circle cx="20" cy="13" r="1" fill="currentColor" stroke="none"/>' +
  '<path d="M15 15.6h2l-1 1.2z" fill="currentColor"/>';

// 소품은 방의 성격을 보여 준다.
const PROPS: Record<GuidePlace, string> = {
  // 책을 펼쳐 읽는 고양이
  library: '<path d="M4 30v-7q6-1 12 1.2 6-2.2 12-1.2v7q-6-1-12 1-6-2-12-1z"/><path d="M16 24.2V31"/>',
  // 서버 랙 앞에 앉은 고양이
  server:
    '<rect x="5" y="22" width="22" height="4.2" rx="1"/><rect x="5" y="26.8" width="22" height="4.2" rx="1"/>' +
    '<circle cx="22.5" cy="24.1" r=".8" fill="currentColor" stroke="none"/><circle cx="22.5" cy="28.9" r=".8" fill="currentColor" stroke="none"/>',
  // 돋보기로 살피는 고양이
  search: '<circle cx="21" cy="25.5" r="4.2"/><path d="M24.2 28.6 29 31.4"/>',
  // 연필을 쥔 고양이
  desk: '<path d="M5 23h16l5 2.6L21 28.2H5z"/><path d="M9 23v5.2"/>',
};

export function catIcon(place: GuidePlace) {
  return `<svg aria-hidden="true" focusable="false" class="icon cat-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${HEAD}${PROPS[place]}</svg>`;
}
