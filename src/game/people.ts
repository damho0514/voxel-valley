/*
 * The people of the valley: everyday Korean characters, played for laughs (all original). Each
 * has a look (how the renderer builds them), a voice (text-to-speech pitch and speed) and a way of
 * talking. Tap one to chat: they answer by voice.
 *
 * Chat is a small rule set for now: keywords → lines in that character's own voice. Later the same
 * panel will carry real voice chat between players who meet on a server.
 */

/** How a figure is built (see VoxelRenderer.makeGoof). */
export type Look = 'me' | 'beard' | 'glasses' | 'kid' | 'phone' | 'barcode';

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

/** A bot's persona by its look ('me' has none). */
export const personaOf = (look: Look | undefined) => PEOPLE.find((p) => p.look === look);

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
