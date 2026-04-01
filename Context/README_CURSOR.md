# CALIX — Cursor Project Setup

## 파일 구조
```
calix-project/
├── context/                     ← 이 폴더를 프로젝트 루트에 넣어
│   ├── CALIX_MEMBERS.md         ← 멤버 + 후보 10명 전체 프로필
│   ├── CALIX_COPY_SKILL.md      ← 카피라이팅 보이스 & 룰
│   ├── CALIX_UX_SKILL.md        ← 디자인 시스템 & 컴포넌트
│   └── CALIX_EPISODES.md        ← 에피소드 구조 + 예시 4편
├── src/
│   ├── components/
│   ├── screens/
│   └── ...
└── README.md
```

## Cursor에서 쓰는 법

작업할 때 채팅창에 파일을 `@` 로 참조해.

### 예시 1 — 화면 만들기
```
@CALIX_UX_SKILL.md @CALIX_COPY_SKILL.md

에피소드 화면 만들어줘.
- 다크 배경
- KAIN과의 에피소드 01 "First Day"
- 상단 바: 에피소드 번호 + 멤버 + 호감도
- 4지선다 선택지
- 하단: 코인 240 + EP 1/12
```

### 예시 2 — 에피소드 카피 생성
```
@CALIX_MEMBERS.md @CALIX_COPY_SKILL.md @CALIX_EPISODES.md

GREY가 THEO를 처음 만나는 에피소드 써줘.
- 세팅: 늦은 밤 연습실
- 호감도 0 상태
- JSON 형식으로: situation + choices 4개 + results 4개
```

### 예시 3 — 컴포넌트 수정
```
@CALIX_UX_SKILL.md

choice-button 컴포넌트 수정해줘.
- 선택 후 chosen 상태 스타일 (금색 border + 약간 밝아짐)
- unchosen 상태 (opacity 0.4)
- 0.2s ease transition
```

## 디자인 토큰 요약
- 배경 (라이트): `#f5f0e8`
- 배경 (다크): `#0a0a0a`
- 텍스트: `#0e0e0e` / `#f5f0e8`
- 골드 액센트: `#c7a86e`
- 뮤트: `#8a8780`
- 헤드 폰트: Playfair Display
- 바디 폰트: Rethink Sans (이탤릭 쓰지 마)
