# CALIX — Copywriting Skill v3
> Load with @CALIX_COPY_SKILL.md in Cursor.
> Companion files: CALIX_MEMBERS.md · CALIX_UX_SKILL.md · CALIX_EPISODES.md

---

## 1. Brand Voice

**Confident. Exciting. Always leaves you wanting more.**

Every line should make the reader tap the next screen.
Warm but strong. Easy but not shallow. Exciting but never try-hard.

### Global Language Rules
- **Audience:** English speakers worldwide — US, UK, Australia, Canada, Singapore, Philippines, India, and beyond
- **Level:** Clear enough for a 13-year-old, interesting enough for a 40-year-old
- **Avoid:** Slang, region-specific idioms, complex grammar
- **Use:** Short punchy sentences, plain vocabulary, big emotional impact

```
❌ "His reticent demeanor belies an astute perceptiveness."
✅ "He's quiet. But he notices everything."
```

---

## 2. Core Principles

**1 — Simple words, strong feelings**
```
❌ "His stoic exterior conceals a depth of character."
✅ "He's hard to read. That's what makes him interesting."
```

**2 — Always pull forward**
```
❌ "Finn is the youngest member of CALIX."
✅ "He's the youngest. And somehow, the one they all watch."
```

**3 — Em dash for drama**
```
"Five members. One sound. Three years of everything.
Then — without a word — one of them left."
```

**4 — Present tense, active voice. Always.**
```
❌ "The practice had been going on for hours."
✅ "They've been at it for three hours. No one's stopping."
```

**5 — Dialogue sounds like real people**
```
❌ "Welcome to the group. I hope you will prove your worth."
✅ "So. You're the new one." [pause] "We'll see how that goes."
```

---

## 3. NARRATIVE & STORY ← Most Important

CALIX is not a game about choices. It's a game about a relationship slowly becoming real.
Every episode is a chapter. Every scene should feel like something is at stake.

### Every episode must do 3 things:
1. **Place you inside a moment** — the reader feels the room, the time, the atmosphere
2. **Move the relationship one step** — something small shifts
3. **Leave something unresolved** — not every episode ends cleanly. That's what pulls you back.

### Scene-building

**Show the environment:**
```
❌ "You're in the practice room with Kain."
✅ "The practice room is cold at 7 AM. The mirrors make it feel even colder.
   Kain is already there."
```

**Use sensory detail:**
```
❌ "It was late and quiet."
✅ "The building is quiet except for the hum of the vending machine down the hall.
   It's past midnight."
```

**Let silence carry weight:**
```
✅ "Theo doesn't answer right away.
   He just keeps looking at the notes in his hand.
   Then, finally: 'Yeah. I noticed.'"
```

**Small moments are the whole story:**
```
✅ "Jay moves over on the bench without saying anything.
   That's it. That's the whole thing.
   But you sit down, and something shifts."
```

### Narrative arc across 12 episodes
- **EP 1–3:** Stranger. Cautious. Everything is a test.
- **EP 4–6:** Familiarity forming. Still fragile. Moments of real warmth.
- **EP 7–9:** Trust tested. Something almost goes wrong.
- **EP 10–12:** The bond is real. Payoff for everything that came before.

---

## 4. EMOTIONAL DEPTH ← Show, Never Tell

```
❌ "Kain was touched by what you said."
✅ "Kain looks at you for a long moment. Then looks away.
   When he speaks again, his voice is slightly different. Quieter."
```

### Emotion lives in the body, not the label
```
❌ "You felt nervous."       ✅ "Your hands won't quite stay still."
❌ "He seemed sad."         ✅ "Something in his face closes off. Like a door, quietly."
❌ "He was excited."        ✅ "He can't stop moving. His knee bounces. He checks his phone twice."
```

### Result texts must feel like consequences, not scores
```
Bad choice result:
❌ "That was wrong. Kain's trust went down."
✅ "The silence after you say it is a different kind of silence.
   You know it immediately. So does he."

Good choice result:
❌ "Kain liked that. Trust went up."
✅ "Something in Kain's posture shifts — barely, but there.
   He doesn't say anything. He doesn't have to."
```

### By relationship stage
```
Early (0–30):   "You're not sure what he thinks of you yet. Honestly? You're not sure he's decided."
Mid (31–70):    "It's small — the way he remembers what you said last time. He probably doesn't think you noticed. You did."
Late (71–100):  "He tells you something he hasn't told the others. You don't make a big deal of it. That's exactly right."
```

---

## 5. DIALOGUE & INTERACTION ← Each Member Sounds Different

### Member voices — never mix these up

**KAIN — short, direct, never wastes a word:**
```
"Don't be late."
"You did well." [turns back to the mirror]
"I noticed." [that's all. It's enough.]
```

**THEO — warm on the surface, precise underneath:**
```
"Hey — good timing. Come watch this."
"That was almost right. One more time?"
"I'll be honest with you." [never comfortable]
```

**JAY — fast, chaotic, suddenly real when it counts:**
```
"Okay okay okay — wait. Say that again."
"No, but for real though." [suddenly serious]
"I don't say this to everyone." [pause] "You're okay."
```

**FINN — bright, quick, occasionally cuts straight through:**
```
"Morning! How are you — actually, I can tell."
[smiling, watching] "Interesting."
"You know what I think?" [he always knows]
```

### Dialogue rules

**Use beats and pauses:**
```
✅ "Kain sets down his water bottle.
   Looks at you.
   'Why are you still here?'
   It's not unfriendly. Exactly."
```

**Let conversations be incomplete:**
```
✅ "THEO: 'I just think—'
   He stops. Shakes his head.
   'Never mind. Let's run it again.'"
```

**Subtext is the real conversation:**
```
What KAIN says:  "Six hours. Don't be late."
What it means:   I'm watching to see if you're serious.

What FINN says:  "Interesting."
What it means:   I've already figured you out.
```

### Response must match the specific choice + specific member
```
Player chose: confident introduction to KAIN
❌ "Kain appreciated your confidence."
✅ "Kain looks at you for exactly one second. Then nods — once.
   Not warm. But real. You'll take it."

Player chose: emotional response to JAY
❌ "Jay was moved by what you said."
✅ "Jay goes quiet — which almost never happens.
   Then: 'Yeah.' He picks up his phone, puts it back down.
   'Yeah, okay. I hear you.'"
```

---

## 6. Words to Never Use
```
❌ reticent, stoic, belies, astute, demeanor
❌ amazing, incredible, legendary
❌ journey, passion, grind
❌ very, really, quite, basically
❌ told / felt / seemed / was → replace with physical behavior
```

---

## 7. Claude API Episode Prompt

```javascript
const episodePrompt = `
You are writing an episode for CALIX, a K-pop simulation game.

RULES:
- Present tense only. Active voice only.
- Simple words. Short sentences. Global English.
- Show emotions through physical behavior — never emotion labels.
- Dialogue must sound like real people, not scripts.
- Every scene should feel like something is at stake.
- Situation ends on tension. Results end with what just shifted.

PLAYER MEMBER: ${selectedMember.name} (${selectedMember.type === 'bright' ? 'warm, energetic' : 'quiet, intense'})
FOCUS MEMBER: ${focusMember.name}
CURRENT AFFINITY: ${affinity}/100
SETTING: ${setting}
THEME: ${theme}

Situation must:
1. Establish physical space and time of day
2. Show what the focus member is doing when the player arrives
3. End on a moment of tension

Results must:
1. Show the member's reaction through behavior, not emotion labels
2. Sound like that specific member's voice
3. End with a hint of what just changed

Return JSON only:
{
  "situation": "2-3 sentences. Present tense. Setting + action + tension.",
  "choices": [
    {"id":"a","text":"confident/direct, max 8 words"},
    {"id":"b","text":"cautious/observational, max 8 words"},
    {"id":"c","text":"practical/neutral, max 8 words"},
    {"id":"d","text":"emotional/relational, max 8 words"}
  ],
  "results": {
    "a": {"text":"2-4 sentences. Behavior not labels. End with what shifted.","trust":12,"coins":30},
    "b": {"text":"2-4 sentences. Behavior not labels. End with what shifted.","trust":5,"coins":20},
    "c": {"text":"2-4 sentences. Behavior not labels. End with what shifted.","trust":8,"coins":25},
    "d": {"text":"2-4 sentences. Behavior not labels. End with what shifted.","trust":-5,"coins":10}
  }
}
`;
```
