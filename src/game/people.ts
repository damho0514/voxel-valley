/*
 * The people of the valley: everyday Korean characters, played for laughs (all original). Each
 * has a look (how the renderer builds them), a voice (text-to-speech pitch and speed) and a way of
 * talking. Tap one to chat: they answer by voice.
 *
 * Chat is a small rule set for now: keywords → lines in that character's own voice. Later the same
 * panel will carry real voice chat between players who meet on a server.
 */

/** How a figure is built (see VoxelRenderer.makeGoof). */
export type Look = 'me' | 'beard' | 'glasses' | 'kid' | 'phone' | 'barcode' | GuideLook;
/** The guides at the dark gate (see GUIDES below and game/guides.ts). */
export type GuideLook = 'lantern' | 'shield' | 'medic' | 'scout';

export type Persona = {
  look: Look;
  name: string;
  emoji: string;
  /** Shirt colour. */
  color: number;
  /** Walking speed (blocks/s). */
  speed: number;
  /** How often they come over to you vs. do their own thing (0..1). */
  follow: number;
  voice: { pitch: number; rate: number };
  /** One-line intro under the name in the chat panel. */
  about: string;
  greet: string[];
  rules: { re: RegExp; say: string[] }[];
  idle: string[];
  /** Tap-to-say suggestions shown in the chat panel. */
  chips: string[];
};

const HINT = '땅을 다섯 칸 넘게 파 내려가 봐. 시공간이 쭉 빨아들여서 꿀알바 편의점으로 간대.';

/** Lines everyone shares (each persona's own rules are tried first). */
const COMMON: Persona['rules'] = [
  { re: /편의점|알바|꿀알바|시급|출근/, say: [HINT, '야간 편의점 알바? 땅 밑으로 다섯 칸. 그 다음은… 나도 몰라.'] },
  { re: /머리|탈모|대머리|빛나|반짝/, say: ['와, 정수리 조명 미쳤다. 손전등 필요 없겠네.', '그 동그라미… 고급 대리석이야? 광택 장난 아니다.'] },
  { re: /도와|어떻게|모르겠|방법/, say: ['블록 위를 쓱 그리고 💥 누르면 한 번에 부서져. 돈도 들어와.', '왼쪽 아래를 밀면 그쪽으로 걸어가. 화면도 알아서 돌아가고.'] },
  { re: /잘\s*가|바이|빠이|안녕히|그만/, say: ['그래, 또 보자!', '들어가~'] },
];

export const PEOPLE: Persona[] = [
  {
    look: 'beard', name: '털보 아저씨', emoji: '🧔', color: 0xb5443c, speed: 2.6, follow: 0.35,
    voice: { pitch: 0.7, rate: 0.92 }, about: '캠핑·낚시가 인생. 수염은 자존심.',
    greet: ['어이, 왔나! 수염 한번 만져 볼래?', '허허, 오늘 날씨 캠핑하기 딱이네.'],
    rules: [
      { re: /안녕|하이|ㅎㅇ|반가/, say: ['오냐, 반갑다! 밥은 먹고 다니냐?'] },
      { re: /뭐\s*해|뭐하|머해/, say: ['장작 패고 있지. 불멍이 최고여.', '낚싯대 손질 중이다. 손맛 알아?'] },
      { re: /배고|밥|라면|먹/, say: ['라면은 역시 캠핑장 버너에 끓여야 제맛이지!', '고기 구울까? 수염에 기름 튀는 게 함정이다.'] },
      { re: /수염|털/, say: ['이 수염 기르는 데 삼 년 걸렸다. 겨울엔 목도리 필요 없지.'] },
      { re: /돈|머니|부자/, say: ['돈? 캠핑 장비 사느라 다 썼다. 허허.'] },
      { re: /몇\s*살|나이/, say: ['마음은 스물. 무릎은 예순.'] },
    ],
    idle: ['허허, 그렇구먼.', '말 나온 김에 캠핑이나 가자.', '수염이 그렇다잖냐.'],
    chips: ['안녕하세요!', '뭐 하세요?', '배고파요', '꿀알바 알아요?'],
  },
  {
    look: 'glasses', name: '안경 선배', emoji: '🤓', color: 0x5d7fb0, speed: 2.4, follow: 0.3,
    voice: { pitch: 1.0, rate: 1.08 }, about: '야근 3년 차. 거북목은 훈장.',
    greet: ['아, 안녕. 잠깐만, 이 메일만 보내고.', '어, 왔어? 커피 한 잔 하고 왔어?'],
    rules: [
      { re: /안녕|하이|ㅎㅇ|반가/, say: ['안녕. 오늘도 칼퇴는 글렀어.'] },
      { re: /뭐\s*해|뭐하|머해/, say: ['보고서 수정 버전 7 최종 진짜최종 만드는 중.', '거북목 스트레칭… 하려고 했는데 일이 생겼어.'] },
      { re: /배고|밥|라면|먹/, say: ['점심은 삼각김밥. 저녁은… 삼각김밥.'] },
      { re: /커피|카페/, say: ['아아 벤티 사이즈 없으면 못 살아.'] },
      { re: /안경|눈/, say: ['이 안경 벗으면 너 못 알아봐. 진짜로.'] },
      { re: /돈|머니|부자|월급/, say: ['월급은 통장을 스쳐 지나갈 뿐이야.'] },
      { re: /몇\s*살|나이/, say: ['나이는 비밀. 연차는 3년.'] },
    ],
    idle: ['음… 그건 검토해 볼게.', '회의 때 다시 얘기하자.', '아, 미안. 메일 알림 때문에.'],
    chips: ['안녕하세요!', '뭐 하세요?', '커피 드실래요?', '월급 얼마예요?'],
  },
  {
    look: 'kid', name: '잼민이', emoji: '🧒', color: 0xf2c94c, speed: 3.8, follow: 0.55,
    voice: { pitch: 1.6, rate: 1.15 }, about: '초딩. 게임 랭크는 너보다 높음.',
    greet: ['ㅋㅋㅋ 님 머리 왜 빛나요?', '아저씨 이 게임 랭크 뭐예요? 저 다이아인데.'],
    rules: [
      { re: /안녕|하이|ㅎㅇ|반가/, say: ['ㅎㅇㅎㅇ! 님 몇 살임?'] },
      { re: /뭐\s*해|뭐하|머해/, say: ['몰라요 그냥 뛰어다니는 중ㅋㅋ', '숙제 안 하고 게임하는 중인데 엄마한테 말하지 마요.'] },
      { re: /배고|밥|라면|먹/, say: ['편의점 컵라면이랑 콜라 사 주세요!', '마라탕 먹고 싶다…'] },
      { re: /몇\s*살|나이/, say: ['열한 살이요. 근데 정신연령은 성인임.'] },
      { re: /돈|머니|부자|용돈/, say: ['용돈 만 원만요. 아 제발요.'] },
      { re: /숙제|공부|학원/, say: ['학원 땡땡이는 아니고… 그냥 쉬는 중이에요.'] },
    ],
    idle: ['ㅋㅋㅋㅋ 개웃기네', '아 진짜요?', '그래서요?', '님 그거 렉 걸린 거 아님?'],
    chips: ['안녕!', '몇 살이야?', '숙제는 했어?', '용돈 줄까?'],
  },
  {
    look: 'phone', name: '폰좀비', emoji: '📱', color: 0x6b6f7a, speed: 1.4, follow: 0.1,
    voice: { pitch: 0.92, rate: 0.85 }, about: '고개를 든 걸 본 사람이 없다.',
    greet: ['…어. 잠깐만. 이것만 보고.', '…응? 아 미안, 숏폼 보고 있었어.'],
    rules: [
      { re: /안녕|하이|ㅎㅇ|반가/, say: ['…응. 안녕.'] },
      { re: /뭐\s*해|뭐하|머해/, say: ['숏폼… 이거 보면 다음 거 또 나와.', '알고리즘이 날 놓아주질 않아.'] },
      { re: /폰|핸드폰|스마트폰|휴대폰/, say: ['배터리 12퍼야. 충전기 있어?'] },
      { re: /목|거북/, say: ['목? 원래 이 각도 아니었어?'] },
      { re: /배고|밥|라면|먹/, say: ['…배달 앱 켜 놨어. 고르는 데 한 시간째.'] },
    ],
    idle: ['…응.', '…ㅋ', '어? 뭐라고 했어?', '잠깐만, 이거 진짜 웃겨.'],
    chips: ['폰 좀 내려놔', '뭐 봐?', '목 안 아파?', '안녕'],
  },
  {
    look: 'barcode', name: '바코드 부장님', emoji: '👔', color: 0x3c4a5c, speed: 2.2, follow: 0.25,
    voice: { pitch: 0.82, rate: 0.95 }, about: '머리카락 다섯 가닥을 정성껏 넘긴다.',
    greet: ['어, 자네 왔나. 라떼는 말이야, 걸어서 출근했어.', '허허, 내 머리 스타일 어때? 오늘 아침에 한 가닥씩 빗었지.'],
    rules: [
      { re: /안녕|하이|ㅎㅇ|반가/, say: ['그래, 반갑네. 악수! 손에 힘 좀 주고.'] },
      { re: /뭐\s*해|뭐하|머해/, say: ['회식 장소 알아보는 중이지. 이번엔 노래방도 간다!'] },
      { re: /배고|밥|라면|먹/, say: ['점심은 내가 쏜다! 단, 메뉴는 내가 정해. 제육.'] },
      { re: /머리|바코드|가닥/, say: ['이건 바코드가 아니라 전략적 배치라네.', '바람 불면 큰일 나. 그러니 실내로 가지.'] },
      { re: /라떼|옛날/, say: ['라떼는 말이야, 삐삐로 연락했어.'] },
      { re: /돈|머니|부자|월급/, say: ['돈은 모으는 게 아니라 아끼는 거야. 그래서 회식은 법카로!'] },
    ],
    idle: ['허허, 그래서 말인데.', '아재 개그 하나 할까? 세상에서 가장 뜨거운 과일은? 천도복숭아!', '요즘 젊은 사람들은 참…'],
    chips: ['안녕하세요 부장님', '머리 멋있어요', '라떼는?', '회식 언제예요?'],
  },
];

/*
 * The guides: four supporters who stand in front of the dark gate and get you started. Each one
 * stands for a role a team will need once worlds become team quests (길잡이, 수호자, 치유사,
 * 정찰대원). All original characters.
 */
const DARK_HINT = '저 자개 문으로 걸어 들어가면 바로 시작이야. 안은 끝없는 노란 방—아무도 없는 사무실이 미로처럼 이어져. 초록 비상구 불빛을 찾아.';
const GUIDE_COMMON: Persona['rules'] = [
  { re: /시작|처음|어떻게|방법|뭐\s*해야|뭘\s*해/, say: [DARK_HINT, '첫 퀘스트는 간단해. 노란 방을 지나서 주차장까지 가는 것. 길은 하나가 아니야.'] },
  { re: /팀|친구|같이|파티|멀티|함께/, say: ['☰ 메뉴에서 방을 만들어 친구를 불러. 같은 방이면 같은 미로에서 만나. 미로 모양도 똑같아.', '앞으로 세계마다 팀을 짜서 퀘스트를 깨게 될 거야. 길잡이, 수호자, 치유사, 정찰대원… 역할을 나눠 봐.'] },
  { re: /주차장|차|지하|옥상|층/, say: ['미로 맨 끝, 초록 불 아래 문 너머가 끝없는 주차장이야. 지하 4층부터 옥상까지 경사로로 이어져.', '주차장 기둥은 층마다 색이 달라. 길을 잃으면 기둥 색을 봐.'] },
  { re: /무서|겁|공포|무섭|싫어/, say: ['무서우면 돌아 나와도 돼. 들어간 문은 늘 그 자리에 있어.', '혼자가 무서우면 친구랑 와. 그러라고 우리가 여기 서 있는 거야.'] },
  { re: /안에|뭐가\s*있|뭐\s*있|어떤\s*곳|어디/, say: ['아무것도 없어. 노란 벽지, 눅눅한 카펫, 웅웅거리는 형광등… 끝없이 이어지는 빈 사무실뿐이야.', '이상한 건, 지나온 형광등이 하나씩 꺼진다는 거야. 뒤돌아보면 깜깜해.'] },
  { re: /퀘스트|임무|미션|목표/, say: ['지금 열린 퀘스트: 노란 방 → 끝없는 주차장. 다음 세계는 곧 열려.', '퀘스트는 혼자도 되지만, 팀이면 훨씬 빨라.'] },
  { re: /길|미로|출구|비상구|못\s*찾/, say: ['한쪽 손으로 벽을 짚고 계속 따라가 봐. 언젠간 나와.', '초록 불빛이 천장에 보이면 거의 다 온 거야.'] },
  { re: /조작|움직|이동|걷/, say: ['왼쪽 아래를 밀면 걸어가. 화면을 끌면 둘러보고.', '양탄자를 타도 그 낮은 천장은 못 뚫어. 걸어서 찾아야 해.'] },
  { re: /안녕|하이|ㅎㅇ|반가/, say: ['어서 와. 저 문 너머가 궁금하지?'] },
  { re: /잘\s*가|바이|빠이|안녕히|그만/, say: ['조심히 다녀와.', '불빛을 잃지 마.'] },
];

export const GUIDES: Persona[] = [
  {
    look: 'lantern', name: '등불지기 달래', emoji: '🏮', color: 0x2a2f4a, speed: 1.6, follow: 0,
    voice: { pitch: 0.95, rate: 0.95 }, about: '길잡이. 등불 하나로 저 안을 백 번 넘게 다녀왔다.',
    greet: ['왔구나. 저 문 너머가 노란 방이야. 준비되면 말해.', '등불 하나면 충분해. …라고 말하고 싶지만, 친구가 있으면 더 좋아.'],
    rules: [
      { re: /등불|불|빛|랜턴/, say: ['이 등불은 안에선 안 켜져. 그래서 내가 여기 서 있는 거야.'] },
      { re: /누구|이름|정체/, say: ['나는 달래. 길잡이야. 길을 알려 주는 게 내 일이지.'] },
    ],
    idle: ['…안에서 무슨 소리 들리지 않았어?', '천천히 가. 서두르면 같은 곳만 돌아.', '준비되면 문으로 걸어 들어가.'],
    chips: ['어떻게 시작해요?', '퀘스트가 뭐예요?', '팀은 어떻게 짜요?', '무서워요'],
  },
  {
    look: 'shield', name: '수호자 단단이', emoji: '🛡️', color: 0x7a5a3a, speed: 1.4, follow: 0,
    voice: { pitch: 0.7, rate: 0.9 }, about: '수호자. 팀 맨 앞에 서서 모두를 지킨다.',
    greet: ['맨 앞은 내가 선다. 따라와.', '흠. 혼자 갈 생각인가? 용감하군.'],
    rules: [
      { re: /방패|지켜|수호|탱/, say: ['팀이 생기면 내가 맨 앞이다. 넌 뒤에서 길을 봐.'] },
      { re: /누구|이름|정체/, say: ['단단이. 이름처럼 단단하지.'] },
    ],
    idle: ['…', '이 방패, 생각보다 무겁다.', '흠.'],
    chips: ['팀은 어떻게 짜요?', '저 안에 뭐가 있어요?', '무서워요', '안녕!'],
  },
  {
    look: 'medic', name: '치유사 보듬', emoji: '🩹', color: 0xf4f6f8, speed: 1.8, follow: 0,
    voice: { pitch: 1.15, rate: 1.0 }, about: '치유사. 다친 사람은 끝까지 챙긴다.',
    greet: ['다친 데는 없지? 들어가기 전에 숨 한번 크게 쉬어.', '안은 많이 어두워. 놀라도 괜찮아, 다들 놀라.'],
    rules: [
      { re: /아파|다쳐|체력|피|회복|치료/, say: ['체력은 가만히 있으면 조금씩 돌아와. 용암만 조심해.', '팀이 생기면 내가 뒤에서 챙길게.'] },
      { re: /누구|이름|정체/, say: ['보듬이야. 보듬어 주는 게 내 일.'] },
    ],
    idle: ['물 마셨어?', '천천히, 천천히.', '혼자 가지 말라니까~'],
    chips: ['무서워요', '팀은 어떻게 짜요?', '어떻게 시작해요?', '안녕!'],
  },
  {
    look: 'scout', name: '정찰대원 살핌', emoji: '🔦', color: 0x4a6a3a, speed: 2.4, follow: 0,
    voice: { pitch: 1.05, rate: 1.12 }, about: '정찰대원. 먼저 들어가 길을 보고 온다.',
    greet: ['나 방금 주차장까지 갔다 왔어! 지하 4층은… 진짜 어두워.', '미로 지도? 그런 건 없어. 근데 요령은 있지.'],
    rules: [
      { re: /지도|요령|팁|힌트/, say: ['초록 불빛! 그게 다야. 그리고 TV 켜진 막다른 길은 그냥 막다른 길이야.', '큰 방이 나오면 잠깐 서서 문이 몇 개인지 세 봐.'] },
      { re: /누구|이름|정체/, say: ['살핌! 이마에 불 달린 사람.'] },
    ],
    idle: ['쉿, 들어 봐.', '주차장 옥상에서 보면 도시가 다 꺼져 있어.', '난 벌써 다녀왔지롱.'],
    chips: ['길 찾는 요령 있어요?', '주차장은 어때요?', '저 안에 뭐가 있어요?', '안녕!'],
  },
];
for (const g of GUIDES) g.rules.push(...GUIDE_COMMON);

/** A bot's persona by its look ('me' has none). */
export const personaOf = (look: Look | undefined) => PEOPLE.find((p) => p.look === look) ?? GUIDES.find((p) => p.look === look);

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export const greetLine = (p: Persona) => pick(p.greet);

/** What this persona says back to `text`. */
export function replyTo(p: Persona, text: string): string {
  const t = text.trim();
  if (!t) return pick(p.idle);
  for (const r of [...p.rules, ...COMMON]) if (r.re.test(t)) return pick(r.say);
  return pick(p.idle);
}

/** Text as it should be spoken: no emoji, laughter read as a laugh. */
export const spoken = (s: string) =>
  s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '').replace(/ㅋ{2,}/g, '크크크').replace(/ㅎㅇ/g, '하이').replace(/…/g, ', ');
