# CALIX — UX & Design System
> Load with @CALIX_UX_SKILL.md in Cursor.
> Companion files: CALIX_MEMBERS.md · CALIX_COPY_SKILL.md

---

## 1. Design Identity

**Mood:** K-pop editorial meets dark luxury. Like a photobook that's also a game.
**Benchmark visual:** Stray Kids
**Target:** English-speaking K-pop fanfic culture, ages 13–40

---

## 2. Color System

```css
:root {
  /* Backgrounds */
  --bg-cream:   #f5f0e8;   /* primary light background */
  --bg-dark:    #0a0a0a;   /* episode screens, dark mode */
  --bg-card:    #111111;   /* cards on dark bg */
  --bg-overlay: #07071A;   /* deep navy for members screen */

  /* Text */
  --ink:        #0e0e0e;   /* primary text on light */
  --ink-light:  #f5f0e8;   /* primary text on dark */
  --muted:      #8a8780;   /* secondary text, labels */
  --muted-dark: #5a5a5a;   /* secondary on dark bg */

  /* Accent */
  --gold:       #c7a86e;   /* primary accent — lines, highlights, CTAs */
  --gold-light: #e8d5a3;   /* hover states */
  --purple-mid: #7B5EA7;   /* hologram accent on dark screens */

  /* Dividers */
  --rule-light: rgba(14,14,14,0.12);
  --rule-dark:  rgba(245,240,232,0.1);

  /* Tags */
  --bright-bg:  #fdf6e8;  --bright-text: #8a6020;
  --dark-bg:    #ececec;  --dark-text:   #3a3a3a;
  --member-bg:  #e8f0ec;  --member-text: #2a5a38;
}
```

---

## 3. Typography

```css
/* Headlines */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&display=swap');
font-family: 'Playfair Display', serif;

/* Body / UI */
@import url('https://fonts.googleapis.com/css2?family=Rethink+Sans:wght@400;500;600;700&display=swap');
font-family: 'Rethink Sans', sans-serif;
/* Note: Rethink Sans replaced EB Garamond for body. Better readability. */
```

### Type Scale
```
Hero title (CALIX):       96px / 700 / Playfair / #0e0e0e
Section headline:         32–48px / 700 / Playfair
Card name:                22–28px / 700 / Playfair
Episode headline:         22px / 700 / Playfair
Body / situation text:    16px / 400 / Rethink Sans / line-height 1.7
Choice text:              14px / 500 / Rethink Sans
UI label (eyebrow):       10–11px / 500 / Rethink Sans / letter-spacing 0.12em / uppercase
Muted detail:             12px / 400 / Rethink Sans / var(--muted)
```

### Rules
- **No italic body copy** — was EB Garamond italic, now Rethink Sans regular
- Eyebrow labels always uppercase + letter-spacing
- Serif (Playfair) for titles and member names only
- Rethink Sans for everything else

---

## 4. Layout — Mobile First (390px base)

```
Screen padding:  32px horizontal
Content width:   326px (390 - 32×2)
Bottom CTA:      full-width button, 52px tall, anchored to bottom
```

---

## 5. Screen-by-Screen Guide

### 01 — Title
- Cream background (#f5f0e8)
- Top corners: "Vol. I" left, "Seoul, KR" right — 11px muted
- Center: eyebrow label → CALIX (96px) → gold vertical line (2px × 80px) → tagline
- Bottom: full-width black CTA button "BEGIN"

### 02 — Situation (The Hook)
- Same cream bg
- Stat table: Group / Active Since / Members / Status
- Horizontal gold rule between rows
- CTA: "MEET THE MEMBERS"

### 03 — Members
- Cream bg, dark feel
- Numbered list: 01 KAIN Leader / 02 THEO Main Dancer / etc.
- 05 — ? Open (dashed, faded)
- Thin horizontal rules between members
- CTA: "CONTINUE"

### 04 — Choose (Candidate Select)
- Dark background
- Filter tabs: All · Bright · Dark
- 3-column card grid (100px × 106px per card)
- Each card: member name + type tag
- Bottom bar: "Your pick — [NAME]" + CONFIRM button

### 05 — Episode
- Dark background
- Top bar: episode number + member name + affinity score
- Situation text (Rethink Sans 16px, not italic)
- "WHAT DO YOU DO?" label
- 4 choice buttons (border 0.5px, hover changes bg)
- Fixed bottom bar: coin balance + episode progress (EP 1 / 12)

### 06 — Reward
- Dark or cream depending on tone
- Stats: affinity +N / group popularity +N / skill +N (progress bars)
- Coin earned
- Reward card (photocard / lightstick unlock)
- CTA: "NEXT EPISODE →"

---

## 6. Components

### CTA Button (Primary)
```css
background: #0e0e0e;
color: #f5f0e8;
height: 52px;
width: 326px;
font: 13px / 700 / Rethink Sans;
letter-spacing: 0.08em;
text-transform: uppercase;
border: none;
border-radius: 0;  /* sharp corners — this is intentional */
```

### Choice Button
```css
background: transparent;
border: 0.5px solid rgba(245,240,232,0.2);
color: #f5f0e8;
padding: 16px 20px;
font: 14px / 500 / Rethink Sans;
width: 100%;
text-align: left;
transition: background 0.2s;

/* hover */
background: rgba(199,168,110,0.08);
border-color: var(--gold);
```

### Gold Divider
```css
width: 2px;
height: 48–80px;
background: #c7a86e;
margin: 16px auto;
```

### Horizontal Rule
```css
height: 0.5px;
background: var(--rule-light);  /* or --rule-dark */
width: 100%;
```

### Tag (Bright / Dark / Member)
```css
font-size: 9–10px;
font-weight: 600;
letter-spacing: 0.1em;
text-transform: uppercase;
padding: 3px 8px;
border-radius: 2px;
/* colors from CSS vars above */
```

### Member Card (Candidate Grid)
```css
width: 100px;
height: 106px;
background: #1a1a1a;
border: 0.5px solid rgba(255,255,255,0.08);
padding: 12px 8px;
display: flex;
flex-direction: column;
justify-content: flex-end;

/* selected state */
border-color: var(--gold);
background: rgba(199,168,110,0.1);
```

### Stat Row
```css
display: flex;
justify-content: space-between;
padding: 12px 0;
border-bottom: 0.5px solid var(--rule-light);
font-size: 13px;
/* left: muted / right: ink or gold highlight */
```

### Progress Bar (Reward screen)
```css
height: 4px;
background: rgba(255,255,255,0.1);  /* track */
/* fill: gold */
background: var(--gold);
transition: width 0.6s ease;
```

---

## 7. Game Data Structures

```javascript
// Candidate
const candidate = {
  id: 'grey',
  name: 'GREY',
  type: 'dark',           // 'bright' | 'dark'
  origin: 'Seoul, KR',
  age: 22,
  trait: 'Dark circles. Darker thoughts.',
  body: 'CALIX has never had someone like Grey.',
  image: '/assets/characters/grey.png',
  stats: { vocal: 72, dance: 65, rap: 45, visual: 88, charisma: 75 }
}

// Member
const member = {
  id: 'kain',
  name: 'KAIN',
  role: 'Leader',
  origin: 'Seoul, KR',
  age: 23,
  quote: "He doesn't speak unless it matters.",
  image: '/assets/members/kain.png'
}

// Episode
const episode = {
  id: 'ep_01',
  number: 1,
  title: 'First Day',
  focusMember: 'kain',
  situation: '...',       // Claude API generated
  choices: [
    { id: 'a', text: 'Introduce yourself first.' },
    { id: 'b', text: 'Wait for him to speak.' },
    { id: 'c', text: "Ask about today's rehearsal." },
    { id: 'd', text: "Say you've seen his performances." }
  ],
  results: {
    a: { text: "Kain nods. Once. That's all you get — but it's something.", trust: 12, coins: 30 },
    b: { text: "Silence. After a minute: 'Smart.' You're not sure what that means.", trust: 5, coins: 20 },
    c: { text: "He hands you a printed schedule. 'Six hours. Don't be late.'", trust: 8, coins: 25 },
    d: { text: "He doesn't react. Just goes back to the mirror.", trust: -5, coins: 10 }
  }
}

// User state
const userState = {
  selectedMember: 'grey',
  coins: 240,
  stats: {
    kain_affinity: 12,
    theo_affinity: 0,
    jay_affinity: 0,
    finn_affinity: 0,
    group_popularity: 5,
    personal_skill: 8,
  },
  completedEpisodes: ['ep_01'],
  unlockedEpisodes: ['ep_01', 'ep_02'],
  inventory: {
    photocards: [],
    lightstick: false
  }
}
```

---

## 8. Cursor Prompt Examples

```
@CALIX_UX_SKILL.md @CALIX_COPY_SKILL.md

Build the episode screen (Screen 05):
- Dark background (#0a0a0a)
- Top bar: "EPISODE 01 — First Day" + "KAIN · Affinity 0"
- Situation text block (Rethink Sans 16px, NOT italic)
- "WHAT DO YOU DO?" label
- 4 choice buttons
- Fixed bottom bar: coins (240) + progress (EP 1 / 12)
- Mobile width 390px
```

```
@CALIX_MEMBERS.md @CALIX_COPY_SKILL.md

Generate an episode where GREY meets THEO for the first time.
Practice room, late at night. Affinity 0.
Return as JSON: situation + 4 choices + 4 results.
```
