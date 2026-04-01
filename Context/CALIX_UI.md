# CALIX_UI.md
# CALIX — UI Design System v1.2

> **CALIX는 항상 라이트 모드입니다.**
> 배경은 라이트 퍼플/핑크 그라디언트. 텍스트 컨트라스트 항상 유지.
> 다크 배경, 다크 테마 전환 금지. 골드는 보상 전용 액센트.

---

## 1. COLOR SYSTEM

v6 기준 CSS 변수. 이 값을 그대로 사용할 것.

```css
:root {
  --purple-light: #977DFF;
  --purple-mid:   #6B4FD8;
  --blue:         #0033FF;

  /* Text — 딥 네이비 계열, 라이트 배경 위에서 높은 컨트라스트 */
  --ink:          #00003D;                  /* 메인 텍스트 */
  --ink-soft:     rgba(0, 0, 61, 0.65);    /* 서브 텍스트 */
  --ink-muted:    rgba(0, 0, 61, 0.38);    /* 힌트, 플레이스홀더 */
  --rule:         rgba(0, 0, 61, 0.10);    /* 구분선, 보더 */

  /* Gold — 보상 전용 */
  --gold:         #C9A84C;
  --gold-light:   #E8D5A3;
  --gold-dark:    #9C7A2E;
}
```

### 배경 시스템
```css
/* 메인 배경 — 애니메이팅 그라디언트 */
body {
  background: linear-gradient(
    135deg,
    #F2E6EE 0%,
    #E4DAFA 25%,
    #D0DAFF 50%,
    #E0D4F8 75%,
    #FFCCF2 100%
  );
  background-size: 400% 400%;
  animation: holo 14s ease infinite;
}

@keyframes holo {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* 앰비언트 오브 — body::before / ::after */
body::before {
  background: radial-gradient(circle, rgba(151,125,255,0.22) 0%, transparent 70%);
}
body::after {
  background: radial-gradient(circle, rgba(0,51,255,0.16) 0%, transparent 70%);
}
```

### 컨트라스트 규칙
| 텍스트 용도 | 컬러 | 배경 | 비고 |
|------------|------|------|------|
| 메인 본문 | `--ink` (#00003D) | 라이트 그라디언트 | ✅ WCAG AA 이상 |
| 서브 텍스트 | `--ink-soft` (65% 불투명) | 라이트 그라디언트 | ✅ 충분한 대비 |
| 힌트/레이블 | `--ink-muted` (38% 불투명) | 라이트 그라디언트 | ⚠️ 장식적 텍스트에만 |
| 퍼플 강조 | `--purple-mid` (#6B4FD8) | 라이트 배경 | ✅ |
| 흰 텍스트 | `#FFFFFF` | 카드 다크 오버레이 위 | 멤버 카드 한정 |

**절대 금지:**
- `--ink-muted`를 본문 텍스트에 사용
- 라이트 배경 위에 연한 퍼플(`--purple-light`)로 본문 작성
- 배경과 유사한 컬러로 텍스트 처리

---

## 2. TYPOGRAPHY

v6 설정 그대로 유지.

```html
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;1,400;1,500&family=Rethink+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
```

```css
--font-display: 'Playfair Display', serif;   /* 타이틀, 에피소드 제목, 멤버 이름 */
--font-body:    'Rethink Sans', sans-serif;  /* 본문, UI, 대사 */
```

### 타입 스케일 (v6 기준)

| 용도 | 폰트 | 사이즈 | 웨이트 | 컬러 |
|------|------|--------|--------|------|
| 게임 타이틀 (CALIX) | Playfair Display | clamp(110px, 24vw, 200px) | 400 | `--ink` |
| 훅 헤드라인 | Playfair Display | clamp(40px, 7vw, 72px) | 400 | `--ink` |
| 훅 강조 (그라디언트) | Playfair Display | 상동 | 400 | gradient(--purple-mid → --blue) |
| 섹션 헤드라인 | Playfair Display | clamp(28px, 3.5vw, 42px) | 400 | `--ink` |
| 멤버 이름 (카드) | Playfair Display | 24px | — | white (카드 오버레이 위) |
| 내비게이션 브랜드 | Playfair Display | 18px | 700, letter-spacing: 0.08em | gradient(--ink → --purple-mid) |
| 본문 / 대사 | Rethink Sans | 16–19px | 400 | `--ink-soft` |
| 캐릭터 이름 레이블 | Rethink Sans | 9–10px | 400, letter-spacing: 0.3–0.35em, uppercase | `--purple-mid` |
| eyebrow / section tag | Rethink Sans | 10–11px | 400, letter-spacing: 0.45em, uppercase | `--purple-mid` |
| UI 레이블 / 메타 | Rethink Sans | 11–13px | 400–500, letter-spacing: 0.2–0.35em | `--ink-muted` |
| 선택지 버튼 | Rethink Sans | 14px | 400–500, letter-spacing: 0.3em, uppercase | `--purple-mid` |

---

## 3. LAYOUT

### 내비게이션
```css
/* 메인 NAV */
.nav {
  position: fixed;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}
```

### 게임 씬 레이아웃
```
┌─────────────────────────────────────────────┐
│  NAV — CALIX 브랜드 + 에피소드 진행 (02/07)  │
├──────────────────────────┬──────────────────┤
│                          │                  │
│   SCENE AREA             │   STATS PANEL    │
│                          │   (우측 고정)     │
│   eyebrow 레이블          │   멤버 트러스트   │
│   "SEOUL · YEAR 3"       │   GROUP REP      │
│                          │   SKILL          │
│   헤드라인                │   💰 COIN        │
│                          │                  │
│   본문 / 대사              │                  │
│                          │                  │
├──────────────────────────┴──────────────────┤
│  CHOICE AREA                                │
└─────────────────────────────────────────────┘
```

### 멤버 카드 줄 (훅 섹션)
```
[ KAIN ] [ THEO ] [ ? EMPTY ] [ JAY ] [ FINN ]
```
- 카드 비율: 세로형 (v6 스타일 유지)
- EMPTY 카드: 점선 원 + "EMPTY" 레이블
- 5번째 멤버 선택 시 해당 자리 채워짐

---

## 4. COMPONENTS

### 대사 박스
```css
.dialogue-box {
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 16px;
  padding: 28px 32px;
  box-shadow: 0 4px 24px rgba(0, 0, 61, 0.08);
}

.character-name {
  font-family: 'Rethink Sans', sans-serif;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: var(--purple-mid);
  margin-bottom: 10px;
}

.dialogue-text {
  font-family: 'Rethink Sans', sans-serif;
  font-size: 18px;
  line-height: 1.8;
  color: var(--ink);  /* --ink-soft 금지 — 레저빌리티 우선 */
}
```

### 나레이션 / 지문
```css
.narration {
  font-family: 'Rethink Sans', sans-serif;
  font-style: italic;
  font-size: 15px;
  line-height: 1.75;
  color: var(--ink-soft);
  padding: 14px 20px;
  border-left: 2px solid var(--purple-light);
  background: rgba(151, 125, 255, 0.07);
  border-radius: 0 8px 8px 0;
  margin: 16px 0;
}
```

### 선택지 버튼
```css
.choice-btn {
  width: 100%;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 10px;
  font-family: 'Rethink Sans', sans-serif;
  font-size: 14px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--purple-mid);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
}

.choice-btn:hover {
  background: rgba(107, 79, 216, 0.1);
  border-color: var(--purple-mid);
  transform: translateX(4px);
}

.choice-btn:active {
  background: rgba(107, 79, 216, 0.18);
}
```

### 스탯 바
```css
.stat-label {
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.stat-bar-track {
  background: rgba(0, 0, 61, 0.08);
  border-radius: 2px;
  height: 4px;
}

.stat-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* 멤버별 */
.stat-kain  { background: #2C2A5E; }
.stat-theo  { background: #CC6B9A; }
.stat-jay   { background: var(--purple-mid); }
.stat-finn  { background: #7A9ECC; }
.stat-rep   { background: var(--purple-light); }
.stat-skill { background: var(--blue); }
```

### 보상 팝업 — 골드 사용 유일한 곳
```css
.reward-popup {
  background: rgba(255, 253, 245, 0.97);
  border: 1px solid var(--gold);
  border-radius: 16px;
  padding: 40px 48px;
  text-align: center;
  box-shadow: 0 8px 40px rgba(201, 168, 76, 0.18);
}

.reward-label {
  font-family: 'Rethink Sans', sans-serif;
  font-size: 10px;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 12px;
}

.reward-item-name {
  font-family: 'Playfair Display', serif;
  font-size: 22px;
  font-weight: 500;
  color: var(--ink);
}

.coin-amount {
  font-family: 'Rethink Sans', sans-serif;
  font-size: 14px;
  color: var(--gold-dark);
}
```

### 멤버 카드
```css
.member-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  aspect-ratio: 2/3;
}

.member-card-role {
  font-size: 9px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: rgba(151, 125, 255, 0.95);
  display: block;
  margin-bottom: 3px;
}

.member-card-name {
  font-family: 'Playfair Display', serif;
  font-size: 24px;
  color: white;
  display: block;
}

.member-card-origin {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}
```

---

## 5. ANIMATIONS (v6 기준)

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes orb1 {
  0%, 100% { transform: translate(0, 0); }
  50%       { transform: translate(70px, 50px); }
}

@keyframes orb2 {
  0%, 100% { transform: translate(0, 0); }
  50%       { transform: translate(-50px, -70px); }
}

/* 대사 등장 */
.dialogue-enter {
  animation: fadeUp 0.4s ease both;
}

/* 선택지 순차 등장 */
.choice-btn:nth-child(1) { animation: fadeUp 0.3s ease 0.05s both; }
.choice-btn:nth-child(2) { animation: fadeUp 0.3s ease 0.10s both; }
.choice-btn:nth-child(3) { animation: fadeUp 0.3s ease 0.15s both; }
.choice-btn:nth-child(4) { animation: fadeUp 0.3s ease 0.20s both; }
```

---

## 6. 레저빌리티 체크리스트

스크립트/코드 작성 전 확인:

- [ ] 본문 텍스트는 `--ink` 또는 `--ink-soft` 사용
- [ ] `--ink-muted`는 레이블/힌트/메타에만
- [ ] 라이트 배경 위 퍼플 텍스트는 `--purple-mid` 이상 (--purple-light 단독 본문 금지)
- [ ] 카드 위 흰 텍스트는 반드시 다크 오버레이 위에만
- [ ] 보상 관련 골드 텍스트는 밝은 배경 위에서만
- [ ] 폰트 사이즈 본문 최소 15px 이상
- [ ] 버튼 텍스트 최소 13px 이상

---

## 7. 절대 금지

```
❌ 다크 배경을 메인 배경으로 사용
❌ prefers-color-scheme: dark
❌ 골드를 UI 메인 컬러로 사용 (보상 전용)
❌ --ink-muted 로 본문 텍스트 처리
❌ 라이트 배경 위 --purple-light 단독 본문 사용
❌ 다크모드 토글
❌ Playfair Display / Rethink Sans 외 폰트 추가
```

---

*CALIX_UI.md v1.2 — 2026.03*
*폰트: Playfair Display + Rethink Sans (v6 기준)*
*배경: 라이트 퍼플-핑크 애니메이팅 그라디언트*
*골드: 보상 전용*
