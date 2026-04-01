# CALIX — Episode Structure & Examples
> Load with @CALIX_EPISODES.md in Cursor.
> Companion files: CALIX_MEMBERS.md · CALIX_COPY_SKILL.md · CALIX_UX_SKILL.md

---

## 1. Episode System Overview

- **Total episodes per playthrough:** 12
- **Focus member per episode:** rotates between KAIN, THEO, JAY, FINN (+ bonus episodes)
- **Choices per episode:** 4 options (A/B/C/D)
- **Outcomes tracked:** affinity ±, coins +, group popularity +, personal skill +
- **Episode types:** Story / Bonus / Hidden

---

## 2. Episode Structure

```
[TOP BAR]
Episode number + title | Focus member name · Affinity N

[SITUATION TEXT]
2–3 sentences. Present tense. Setting included. Ends on tension.

[PROMPT LABEL]
"WHAT DO YOU DO?"

[4 CHOICES]
A — confident/direct
B — cautious/observational
C — practical/neutral
D — emotional/relational

[RESULT PANEL] (slides up after choice)
2–3 sentence consequence text
Stat changes: Trust ±N / Coins +N

[BOTTOM BAR]
Coin balance | Episode N / 12
```

---

## 3. Affinity Impact Scale

| Trust change | Label | Meaning |
|---|---|---|
| +15 to +20 | Great | Perfect read of the situation |
| +8 to +14 | Good | Solid choice |
| +1 to +7 | Okay | Safe but forgettable |
| -1 to -9 | Miss | Wrong tone |
| -10 to -20 | Bad | Sets the relationship back |

---

## 4. Episode Map (12 Episodes)

| EP | Focus Member | Setting | Theme |
|----|-------------|---------|-------|
| 01 | KAIN | Practice room, morning | First impression |
| 02 | FINN | Dorm hallway, late night | Getting comfortable |
| 03 | THEO | Studio, afternoon | Standards and pressure |
| 04 | JAY | Convenience store run | Off-duty, real talk |
| 05 | KAIN | Rooftop, after rehearsal | Trust test |
| 06 | All members | Group dinner | Group dynamics |
| 07 | THEO | Pre-show backstage | High pressure moment |
| 08 | FINN | Practice room, alone | What he actually thinks |
| 09 | JAY | Late night studio | Real conversation |
| 10 | KAIN | Manager's office aftermath | Serious moment |
| 11 | All members | Comeback prep | Your place in the group |
| 12 | Focus: your bond | Stage, final performance | Payoff |

---

## 5. Written Episodes (Ready to Use)

---

### EPISODE 01 — "First Day"
**Focus:** KAIN · Affinity 0 · Practice room, morning

**Situation:**
"Kain is already at the mirror when you walk in.
He doesn't turn around. Just watches your reflection.
'You're early,' he says. That's all."

**Choices:**
```
A. Introduce yourself first.
B. Wait for him to speak.
C. Ask about today's rehearsal.
D. Say you've seen his performances.
```

**Results:**
```
A (+12 / +30c):
"Kain looks at you for a moment. Then nods — once, quick.
Not warm. But real."

B (+5 / +20c):
"He goes back to stretching. Silence. After a minute: 'Smart.'
You're not sure what that means."

C (+8 / +25c):
"He hands you a printed schedule without looking up.
'Six hours. Don't be late.'"

D (-5 / +10c):
"He doesn't react. Just goes back to the mirror.
You've said the wrong thing. You just don't know it yet."
```

---

### EPISODE 02 — "2 AM"
**Focus:** FINN · Affinity 0 · Dorm kitchen, late

**Situation:**
"You can't sleep. Neither can Finn, apparently.
He's sitting on the counter eating cereal straight from the box.
He sees you. Doesn't look surprised at all."

**Choices:**
```
A. Sit down and grab a handful.
B. Nod and keep going to your room.
C. Ask him why he's still up.
D. Tell him you couldn't sleep either.
```

**Results:**
```
A (+14 / +30c):
"He slides the box over without a word. You sit there in the dark,
eating in silence. It's actually fine.
When you finally go to bed, he says: 'Hey. Good night.'
Like he means it."

B (+2 / +10c):
"He gives you a little wave. You walk past.
It's fine. But there was something there,
and you just let it close."

C (+8 / +20c):
"'Couldn't turn my brain off,' he says.
He doesn't elaborate. But he doesn't seem to mind you asking."

D (+10 / +25c):
"He looks at you properly for the first time.
'Yeah?' he says. Something about the way he says it
makes you think he does this a lot."
```

---

### EPISODE 03 — "One More Time"
**Focus:** THEO · Affinity 0 · Studio, 4 PM

**Situation:**
"Theo is running the same eight counts for the fourth time.
Alone. The others have gone.
He doesn't stop when you come in — just keeps going."

**Choices:**
```
A. Watch without saying anything.
B. Ask if he wants company.
C. Tell him it looked clean from here.
D. Ask if something's bothering him.
```

**Results:**
```
A (+10 / +25c):
"He finishes. Pauses. Looks over at you.
'You stayed.' Not a question.
He goes back to the start. This time you watch it properly."

B (+8 / +20c):
"He pauses. 'Sure.' One word.
You're not sure if that's warm or not.
But you stay."

C (-3 / +10c):
"'Almost,' he says.
He's not being cruel. He's being accurate.
That might be worse."

D (+5 / +15c):
"'Nothing's bothering me,' he says.
You both know that's not quite true.
He keeps going anyway."
```

---

### EPISODE 04 — "11 PM Snack Run"
**Focus:** JAY · Affinity 0 · Convenience store

**Situation:**
"Jay is standing in front of the ramen section like it's a major decision.
He's been here for four minutes.
He hears you come in and turns around: 'Oh thank god. Help me.'"

**Choices:**
```
A. Pick something immediately.
B. Ask what the options are.
C. Say you have no idea either.
D. Ask why this requires help.
```

**Results:**
```
A (+12 / +30c):
"He looks at what you picked. Considers it.
'Okay. Yeah. Good call.' He grabs the same one.
You eat standing up outside. It's weirdly comfortable."

B (+6 / +20c):
"He lists seven options. In detail.
You pick the fourth. He immediately second-guesses it.
You eat it anyway. It was fine."

C (+10 / +25c):
"He points at you. 'See! This is the problem!'
But he's laughing. You end up getting two things and sharing.
He talks the whole way back."

D (+3 / +15c):
"'It REQUIRES it,' he says, completely serious.
He ends up getting three things anyway.
You walk back together. He offers you some."
```

---

## 6. Claude API Prompt Template

```javascript
const episodePrompt = `
You are writing an episode for CALIX, a K-pop simulation game.

TONE: Confident. Exciting. Present tense. Simple words.
AUDIENCE: Global English speakers, ages 13–40.

PLAYER MEMBER: ${selectedMember.name} (${selectedMember.type})
FOCUS MEMBER: ${focusMember.name}
CURRENT AFFINITY: ${affinity}/100
SETTING: ${setting}
EPISODE THEME: ${theme}

Write one episode. Return JSON only — no explanation, no markdown.

{
  "situation": "2-3 sentences, present tense, setting included, ends on tension",
  "choices": [
    {"id":"a","text":"confident/direct, max 8 words"},
    {"id":"b","text":"cautious/observational, max 8 words"},
    {"id":"c","text":"practical/neutral, max 8 words"},
    {"id":"d","text":"emotional/relational, max 8 words"}
  ],
  "results": {
    "a": {"text":"consequence, 2-3 sentences","trust":12,"coins":30},
    "b": {"text":"consequence, 2-3 sentences","trust":5,"coins":20},
    "c": {"text":"consequence, 2-3 sentences","trust":8,"coins":25},
    "d": {"text":"consequence, 2-3 sentences","trust":-5,"coins":10}
  }
}
`;
```

---

## 7. Coin & Reward System

### Earning Coins
| Action | Coins |
|--------|-------|
| Episode clear | +20–50 |
| Best choice (trust +15 or more) | +50 |
| Good choice (trust +8 to +14) | +30 |
| Any choice | +10 minimum |
| Affinity milestone (30 / 70 / 100) | +100 |
| Group popularity milestone | +100 |

### Spending Coins
| Item | Cost |
|------|------|
| New episode unlock | 50–100 coins |
| Hidden episode | 200 coins |
| Member photocard | 150–300 coins |
| Lightstick | 500 coins |
| Costume item | 200–500 coins |

---

## 8. Stats Tracked

```javascript
stats: {
  // Per member (0–100)
  kain_affinity: 0,
  theo_affinity: 0,
  jay_affinity: 0,
  finn_affinity: 0,

  // Group-level (0–100)
  group_popularity: 0,
  personal_skill: 0,
  group_position: 0,   // your standing inside CALIX
}
```
