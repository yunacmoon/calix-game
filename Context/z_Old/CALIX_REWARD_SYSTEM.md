# CALIX — Reward System v2
> Load with @CALIX_REWARD_SYSTEM.md in Cursor.
> Companion files: CALIX_MEMBERS.md · CALIX_EPISODES.md

---

## 1. Core Concept

**Everything is received. Nothing is bought.**

Rewards come to the player automatically — through playing episodes, making choices,
and deepening relationships. They stack up in the player's inventory like a collection.
The feeling should be: *something just arrived. Go check.*

```
Rewards
├── 1. Tokens          ← currency earned through gameplay
└── 2. Items           ← received automatically, stack in inventory
    ├── Photocards     ← unlocked by affinity milestones
    ├── Lightstick     ← unlocked by group popularity milestone
    └── Gifts          ← given by members as relationship deepens
                          can be exchanged for tokens if desired
```

---

## 2. Tokens

Earned through gameplay. Used only to unlock episodes — not to buy items.
Items are always received, never purchased.

### Earning Tokens
| Action | Tokens |
|--------|--------|
| Episode clear (any) | +20 |
| Good choice (trust +8 to +14) | +30 |
| Great choice (trust +15 or more) | +50 |
| Minimum per choice | +10 |
| Affinity milestone (30 / 70 / 100) | +100 |
| Group popularity milestone | +100 |
| Sell a gift (optional) | varies |

### Spending Tokens
| Action | Cost |
|--------|------|
| Unlock next episode | 50 |
| Unlock hidden episode | 200 |

---

## 3. Items — All Received, Never Bought

### 3-1. Photocards

Automatically received when affinity milestones are reached.
Stacks in inventory. Feels like finding something in the mail.

```javascript
const photocards = [
  // KAIN
  { id: 'kain_normal',  member: 'KAIN', rarity: 'Normal',  name: 'Practice Room', unlockAt: 30 },
  { id: 'kain_rare',    member: 'KAIN', rarity: 'Rare',    name: 'Rooftop',       unlockAt: 70 },
  { id: 'kain_special', member: 'KAIN', rarity: 'Special', name: 'First Stage',   unlockAt: 100 },
  // THEO
  { id: 'theo_normal',  member: 'THEO', rarity: 'Normal',  name: 'Studio',        unlockAt: 30 },
  { id: 'theo_rare',    member: 'THEO', rarity: 'Rare',    name: 'Backstage',     unlockAt: 70 },
  { id: 'theo_special', member: 'THEO', rarity: 'Special', name: 'Mirror',        unlockAt: 100 },
  // JAY
  { id: 'jay_normal',   member: 'JAY',  rarity: 'Normal',  name: 'Convenience Store', unlockAt: 30 },
  { id: 'jay_rare',     member: 'JAY',  rarity: 'Rare',    name: 'Late Night',    unlockAt: 70 },
  { id: 'jay_special',  member: 'JAY',  rarity: 'Special', name: 'On Stage',      unlockAt: 100 },
  // FINN
  { id: 'finn_normal',  member: 'FINN', rarity: 'Normal',  name: 'Dorm Kitchen',  unlockAt: 30 },
  { id: 'finn_rare',    member: 'FINN', rarity: 'Rare',    name: 'Practice',      unlockAt: 70 },
  { id: 'finn_special', member: 'FINN', rarity: 'Special', name: 'Watching You',  unlockAt: 100 },
]
```

**Trigger logic:**
```javascript
function checkPhotocardUnlock(member, newAffinity, previousAffinity) {
  const milestones = [30, 70, 100];
  milestones.forEach(milestone => {
    if (newAffinity >= milestone && previousAffinity < milestone) {
      const card = photocards.find(
        p => p.member === member && p.unlockAt === milestone
      );
      if (card) {
        addToInventory('photocard', card);
        showNotification(`New photocard! ${member} — ${card.name} ✨`);
      }
    }
  });
}
```

---

### 3-2. Lightstick

Received automatically when group popularity reaches 70.
One item. Kept forever.

```javascript
const lightstick = {
  id: 'calix_lightstick',
  name: 'CALIX Official Lightstick',
  description: "The real thing. CALIX colors. Yours now.",
  unlockAt: 'group_popularity >= 70'
}

function checkLightstickUnlock(groupPopularity) {
  if (groupPopularity >= 70 && !inventory.lightstick) {
    inventory.lightstick = true;
    showNotification(`Your CALIX lightstick just arrived! 🎉`);
  }
}
```

---

### 3-3. Gifts (from members)

Given automatically as affinity deepens during episodes.
Stacks in inventory like a collection.
Player can keep them or exchange for tokens — their choice.

```javascript
const gifts = [
  {
    id: 'gift_drink',
    name: 'Iced Americano',
    description: "He remembered how you take it. He won't admit that.",
    triggerAffinity: 20,
    tokenValue: 20,
    icon: '☕'
  },
  {
    id: 'gift_chocolate',
    name: 'Chocolate Bar',
    description: 'Left on your stuff without a word. No note.',
    triggerAffinity: 25,
    tokenValue: 25,
    icon: '🍫'
  },
  {
    id: 'gift_snack_bag',
    name: 'Snack Bag',
    description: 'Everything you mentioned once, offhand. He was listening.',
    triggerAffinity: 35,
    tokenValue: 40,
    icon: '🍿'
  },
  {
    id: 'gift_earphones',
    name: 'Wired Earphones',
    description: 'Still in the box. He said he had a spare.',
    triggerAffinity: 40,
    tokenValue: 80,
    icon: '🎧'
  },
  {
    id: 'gift_hair_clip',
    name: 'Hair Clip',
    description: "He saw it and thought of you. He said that out loud and immediately regretted it.",
    triggerAffinity: 45,
    tokenValue: 50,
    icon: '✂️'
  },
  {
    id: 'gift_playlist',
    name: 'Handwritten Playlist',
    description: "Songs he thinks you'd like. His handwriting is terrible. You can still read it.",
    triggerAffinity: 50,
    tokenValue: 60,
    icon: '📝'
  },
  {
    id: 'gift_practice_photo',
    name: 'Practice Room Photo',
    description: "A shot from rehearsal. You're in the background. He cropped it so you're the focus.",
    triggerAffinity: 55,
    tokenValue: 120,
    icon: '🖼️'
  },
  {
    id: 'gift_hoodie',
    name: 'Oversized Hoodie',
    description: "His. He said it was getting too small. It wasn't.",
    triggerAffinity: 65,
    tokenValue: 150,
    icon: '🧥'
  },
  {
    id: 'gift_necklace',
    name: 'Silver Necklace',
    description: "He picked it up on a schedule trip. Said it looked like something you'd wear.",
    triggerAffinity: 75,
    tokenValue: 200,
    icon: '📿'
  },
  {
    id: 'gift_polaroid',
    name: 'Polaroid Photo',
    description: "The two of you. From that night. You didn't even know he took it.",
    triggerAffinity: 85,
    tokenValue: 300,
    icon: '📷'
  },
]
```

### Gift exchange values
| Gift | Token Value |
|------|-------------|
| Iced Americano | 20 |
| Chocolate Bar | 25 |
| Snack Bag | 40 |
| Hair Clip | 50 |
| Wired Earphones | 80 |
| Handwritten Playlist | 60 |
| Practice Room Photo | 120 |
| Oversized Hoodie | 150 |
| Silver Necklace | 200 |
| Polaroid Photo | 300 |

**Trigger logic:**
```javascript
function checkGiftTrigger(member, newAffinity, previousAffinity) {
  const eligible = gifts.filter(g =>
    g.triggerAffinity <= newAffinity &&
    g.triggerAffinity > previousAffinity
  );
  eligible.forEach(gift => {
    addToInventory('gift', { ...gift, from: member });
    showNotification(`${member} left you something. Check your inventory.`);
  });
}

function sellGift(giftId) {
  const gift = gifts.find(g => g.id === giftId);
  if (!gift) return;
  removeFromInventory('gift', giftId);
  addTokens(gift.tokenValue);
  showNotification(`You exchanged the ${gift.name} for ${gift.tokenValue} tokens.`);
}
```

---

## 4. Inventory State

```javascript
const inventory = {
  tokens: 0,

  // array of received photocard ids
  photocards: [],
  // e.g. ['kain_normal', 'theo_normal']

  // true once unlocked
  lightstick: false,

  // array of received gifts
  gifts: [
    // { giftId: 'gift_drink', from: 'KAIN', receivedEpisode: 'ep_04', kept: true }
  ]
}
```

---

## 5. Inventory UI — "The Warehouse" Feel

The inventory should feel like a personal collection that grows over time.
Not a shop. Not a menu. A shelf full of things that mean something.

```
INVENTORY
─────────────────────────────────
  Photocards          4 / 12
  [ KAIN ] [ THEO ] [ ?? ] [ ?? ]

  Lightstick          locked

  Gifts               3 items
  ☕ Iced Americano — from KAIN
  🍫 Chocolate — from FINN
  🎧 Earphones — from THEO
      [Exchange for 80 tokens]
─────────────────────────────────
```

---

## 6. Notification Copy

```javascript
// Photocard received
`New photocard! ${member} — ${cardName}. ✨`
`${member}'s ${rarity} card just arrived.`

// Lightstick received
`Your CALIX lightstick just arrived! 🎉`
`Official. Yours. The CALIX lightstick is in your collection.`

// Gift received
`${member} left you something. Check your inventory.`
`Something just came in — from ${member}.`

// Gift exchanged
`You exchanged the ${giftName} for ${tokenValue} tokens.`

// Tokens earned
`+${amount} tokens.`
`Episode clear! +${amount} tokens.`
`Nice choice. +${amount} tokens.`

// Milestone
`${member}'s trust hit ${level}. Something new just unlocked.`
```
