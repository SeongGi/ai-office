// Talk for the cats gathered in the corridor when an employee retires. Plain data and pure functions so node
// tests can lint it. A line is [slot, text]: slot 0..3 picks the speaker among the cats standing there.
// "{name}" is the leaving cat's name (clipped to NAME_MAX); a line must stay within MAX_LINE after filling.
export const MAX_LINE = 18;
export const NAME_MAX = 8;
export const HISTORY = 5;

export const FAREWELL_SCRIPTS = [
  [[0, '{name} 님, 수고했어요'], [1, '정말 고생 많았어'], [2, '푹 쉬어요!']],
  [[0, '고생 많았어요'], [1, '그동안 고마웠어'], [0, '건강 챙겨요'], [1, '또 놀러 와요']],
  [[0, '츄르 챙겨 가요'], [1, '가는 길에 먹어요'], [0, '내 몫도 부탁해요'], [1, '그건 안 돼요']],
  [[0, '엘리베이터 조심!'], [1, '문에 꼬리 끼어요'], [0, '그건 아프지'], [1, '살짝 들고 타요']],
  [[0, '인수인계는 끝났나요'], [1, '문서는 다 줬어요'], [0, '비밀번호도요?'], [1, '그건 말씀드렸죠']],
  [[0, '퇴근길 한잔?'], [1, '우유 한잔 어때요'], [2, '나도 갈래요'], [0, '다 같이 가요']],
  [[0, '{name} 님 없으면'], [1, '허전하겠어요'], [0, '창가 자리 비네요'], [1, '내가 앉을게요']],
  [[0, '그동안 감사했어요'], [1, '많이 배웠어요'], [0, '꼬리 흔들며 인사!'], [1, '잘 가요, 야옹']],
  [[0, '오늘이 마지막이네요'], [1, '믿기지 않아요'], [0, '시간 참 빠르네'], [1, '푹 쉬고 오세요']],
  [[0, '이제 낮잠은 마음껏'], [1, '부럽다, 정말'], [2, '해 잘 드는 곳에서요'], [0, '깨우지 않을게요']],
  [[0, '월요일이 없는 삶'], [1, '상상만 해도 좋네'], [0, '우리도 곧 가요'], [1, '그날이 올까요']],
  [[0, '짐은 다 챙겼어요?'], [1, '사료 그릇은요?'], [0, '캣타워는 두고 가요'], [1, '그건 우리 거예요']],
  [[0, '{name} 님 덕분에'], [1, '프로젝트가 끝났어요'], [2, '진짜 든든했어요'], [0, '고마워요']],
  [[0, '축하해요!'], [1, '박수 쳐 줘요'], [2, '짝짝짝!'], [0, '발바닥이 아파요']],
  [[0, '새 출발을 응원해요'], [1, '어딜 가도 잘할 거예요'], [0, '우리 잊지 말아요'], [1, '메일은 보내요']],
  [[0, '퇴사 선물이에요'], [1, '털실 공이네요'], [0, '아껴서 굴리세요'], [1, '고마워요, 야옹']],
  [[0, '마지막 커피 한 잔?'], [1, '이미 마셨어요'], [0, '세 잔이나요?'], [1, '추억이니까요']],
  [[0, '다음 회식은 누가요'], [1, '{name} 님이 쏘세요'], [0, '마지막이니까요'], [1, '츄르로 쏠게요']],
  [[0, '잘 가요'], [1, '또 만나요'], [2, '건강하세요'], [3, '행복하세요']],
  [[0, '사원증은 반납했나요'], [1, '네, 방금 냈어요'], [0, '사진이 웃기던데'], [1, '그건 비밀이에요']],
  [[0, '이 복도도 마지막'], [1, '발소리가 쓸쓸해요'], [0, '아니, 박수 소리!'], [1, '짝짝짝 짝짝']],
  [[0, '자리 정리는 했어요'], [1, '네, 먼지 하나 없어요'], [0, '화분도 챙겼죠?'], [1, '선인장은 두고 가요']],
  [[0, '{name} 님, 사랑해요'], [1, '나도, 나도요'], [2, '울지 말고 웃어요'], [0, '야옹 하고 인사!']],
  [[0, '앞으로 뭐 할 거예요'], [1, '세계 일주 어때요'], [0, '아니, 낮잠 여행'], [1, '그게 최고죠']],
  [[0, '이 순간을 기억해요'], [1, '사진 한 장 찍어요'], [2, '모두 모여 봐요'], [0, '하나 둘, 야옹!']],
  [[0, '고생했어요'], [1, '정말 대단했어요'], [0, '부럽기도 하네요'], [1, '푹 쉬세요']],
  [[0, '엘리베이터 왔어요'], [1, '벌써요?'], [0, '아쉽지만 가세요'], [1, '안녕, 안녕!']],
  [[0, '오늘은 야근 없죠'], [1, '이제 평생 없어요'], [2, '와, 정말 좋겠다'], [0, '질투 나요']],
  [[0, '우리 팀의 별이었어요'], [1, '반짝반짝했죠'], [0, '이제 하늘로 가요'], [1, '아니, 집으로요']],
];

/** Pick a scenario whose id is not in `lastIds` (the last HISTORY picks). `rng` returns [0, 1). */
export function pickFarewell(rng, lastIds = []) {
  const recent = new Set(lastIds.slice(-HISTORY));
  const open = [];
  for (let i = 0; i < FAREWELL_SCRIPTS.length; i++) if (!recent.has(i)) open.push(i);
  const pool = open.length ? open : FAREWELL_SCRIPTS.map((_, i) => i);
  const id = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  return { id, lines: FAREWELL_SCRIPTS[id] };
}

/** Fill "{name}" with the leaving cat's name, clipped to NAME_MAX characters. A blank name reads as 친구. */
export function fillName(text, name) {
  const clean = [...String(name ?? '').trim()].slice(0, NAME_MAX).join('') || '친구';
  return text.replaceAll('{name}', clean);
}

// What the leaving cat says on its way to the elevator.
export const GOODBYES = ['먼저 갈게요!', '모두 고마웠어요', '안녕, 또 봐요!', '다들 잘 지내요', '먼저 가 볼게요', '건강하세요, 여러분'];
