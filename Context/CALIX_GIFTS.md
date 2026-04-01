# CALIX_GIFTS.md
# CALIX — Gift System Reference

## Overview
Between episodes, the player has a random chance to send a gift to one CALIX member. Gifts cost coins and raise the chosen member's trust stat by +1.

---

## Gift Types

| Gift | Cost | Trust Effect |
|------|------|-------------|
| Coffee | 100 coins | +1 |
| Snacks | 100 coins | +1 |

---

## Trigger
- Appears randomly between episodes (not every time)
- Only appears if player has 100 or more coins
- Player chooses: which member, which gift
- Coins deducted immediately on confirm

---

## Thank You Messages

### KAIN
- **Coffee:** "Thanks. I'll enjoy it."
- **Snacks:** "You didn't have to. I'll have it after practice."

### THEO
- **Coffee:** "Wait, is this for me?? You're the best — honestly, thank you."
- **Snacks:** "Snacks AND coffee?? Okay, you're officially my favorite person."

### JAY
- **Coffee:** "...Received."
- **Snacks:** "Thanks. We should eat together sometime."

### FINN
- **Coffee:** "Oh my god, thank you so much?? You just saved my entire day."
- **Snacks:** "How did you know I liked these?? This is so nice of you."

---

## UI Flow
1. Gift screen appears between episodes
2. Player selects a member (portrait grid)
3. Player selects a gift (Coffee / Snacks)
4. Confirm button — coins deducted, trust +1
5. Thank you message appears as a text message bubble from that member
6. Player continues to next episode

---

*CALIX_GIFTS.md v1.0 — 2026.03*
