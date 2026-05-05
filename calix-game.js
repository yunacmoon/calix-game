/* CALIX — static game engine (fetch Context/*.md + scripts via relative paths only) */
(function () {
  'use strict';

  const BASE = 'Context/';
  const SCRIPTS = BASE + 'scripts/';

  const TRUST_KEYS = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST'];

  // ── Paywall ──────────────────────────────────────────────────────────────
  const PAYWALL_EPISODE = 4; // ep 4+ requires premium unlock
  const PREMIUM_KEY = 'calix_premium_unlocked';

  function isRunningInTWA() {
    // Digital Goods API only exists in TWA (Android Play context)
    return 'getDigitalGoodsService' in window;
  }

  function isPremiumUnlocked() {
    // Web users always have full access — paywall only applies in Android TWA
    if (!isRunningInTWA()) return true;
    return localStorage.getItem(PREMIUM_KEY) === 'true';
  }

  // Called when player taps "Unlock Full Story"
  // Uses Digital Goods API (TWA/Play Billing) when available
  window.calixRequestPurchase = async function () {
    // TWA + Google Play Billing via Digital Goods API
    if ('getDigitalGoodsService' in window) {
      try {
        const service = await window.getDigitalGoodsService('https://play.google.com/billing');
        const details = await service.getDetails(['calix_full_game']);
        if (!details || details.length === 0) {
          alert('Product not found. Please try again later.');
          return;
        }
        const paymentRequest = new PaymentRequest(
          [{ supportedMethods: 'https://play.google.com/billing', data: { sku: 'calix_full_game' } }],
          { total: { label: 'CALIX Full Story', amount: { currency: details[0].price.currency, value: details[0].price.value } } }
        );
        const response = await paymentRequest.show();
        await response.complete('success');
        // Acknowledge purchase via service
        await service.acknowledge(response.details.token, 'onetime');
        window.calixUnlockPremium();
      } catch (err) {
        if (err.name !== 'AbortError') {
          alert('Purchase failed. Please try again.');
        }
      }
      return;
    }
    // Fallback: web browser (not in TWA)
    alert('Full game unlock is available on the Android app.\nDownload CALIX on Google Play!');
  };

  // Called by Android Play Billing after successful purchase
  window.calixUnlockPremium = function () {
    localStorage.setItem(PREMIUM_KEY, 'true');
    // Resume the episode the player was trying to enter
    if (gameState.currentEpisodeN >= PAYWALL_EPISODE) {
      startEpisode(gameState.currentEpisodeN);
    }
  };
  // ─────────────────────────────────────────────────────────────────────────
  const STAT_MAX = {
    KAIN_TRUST: 15,
    THEO_TRUST: 15,
    JAY_TRUST: 15,
    FINN_TRUST: 15,
    GROUP_REP: 18,
    SKILL: 15,
  };

  let episodesIndex = [];
  let episodesMapMeta = {};
  let gameState = {
    stats: { KAIN_TRUST: 0, THEO_TRUST: 0, JAY_TRUST: 0, FINN_TRUST: 0, GROUP_REP: 0, SKILL: 0, COINS: 0 },
    inventory: [],
    currentEpisodeN: 1,
    candidateName: null,
    candidateArchetype: null,
    candidateBlurb: null,
    episodeChoices: {},
    unlockedThrough: 1,
    lastGiftMember: null,
    lastGiftEpisode: null,
    photocardCount: 0,
  };

  let flowQueue = [];
  let flowIdx = 0;
  let choiceBlockIdx = 0;
  let lastNarrationFp = '';
  let lastDialogueDedup = '';
  /** First "the new member" replacement per speaker class within one episode stream. */
  let newMemberInject = { theo: false, kain: false, narr: false };
  /** Per scene: first vocative prefix applied per member speaker (THEO, KAIN, …). */
  let firstAddressPrefixBySpeaker = {};
  const MEMBER_SPEAKERS = { THEO: true, KAIN: true, JAY: true, FINN: true };
  let currentEpisodeTitle = '';
  let episodeFeaturedMember = null;
  let episodeSpeakerRunningCount = { KAIN: 0, THEO: 0, JAY: 0, FINN: 0 };
  let pendingReward = { coins: 0, itemLabel: null, rewardName: '', typeKey: 'coins', typeLabel: 'Coins' };
  /** Cumulative trust/skill deltas from choices this episode (for reward popup reaction). */
  let episodeChoiceStatDelta = {};
  let selectedCardEl = null;
  let candidateDetailCard = null;
  let candidateBackstories = {};
  let candidateProfilesPromise = null;
  var giftShownThisEpisode = false;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stripMd(s) {
    return String(s)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .trim();
  }

  /** Parse Context/CANDIDATE_PROFILES.md v2 (## ALEX / YOOJIN / GREY — fan order: left / center / right). */
  function parseCandidateProfilesFromMd(md) {
    const NAMES = ['ALEX', 'YOOJIN', 'GREY'];
    const out = {};
    NAMES.forEach(function (name) {
      const pat = new RegExp('^##[^\\n]*\\b' + name + '\\b[\\s\\S]*?(?=^##[^#]|\\Z)', 'm');
      const m = md.match(pat);
      if (!m) return;
      const block = m[0];
      const fromLine = block.match(/\*\*From:\*\*\s*([^\n]+)/);
      const origin = fromLine ? stripMd(fromLine[1].trim()) : '';

      const whoM = block.match(/### Who he is\s*\n([\s\S]*?)(?=\n### Backstory)/);
      const backM = block.match(/### Backstory\s*\n([\s\S]*?)(?=\n\*\*What he gave up:\*\*)/);
      const who = whoM ? whoM[1].trim() : '';
      const backIntro = backM ? backM[1].trim() : '';
      let previous = [who, backIntro].filter(Boolean).join('\n\n');
      previous = stripMd(previous);

      const gaveM = block.match(/\*\*What he gave up:\*\*\s*([^\n]+)/);
      const broughtM = block.match(/\*\*What he brought:\*\*\s*([^\n]+)/);
      const shadowM = block.match(/\*\*His shadow:\*\*\s*([^\n]+)/);

      out[name] = {
        origin: origin,
        previous: previous,
        gave: gaveM ? stripMd(gaveM[1]) : '—',
        brought: broughtM ? stripMd(broughtM[1]) : '—',
        shadow: shadowM ? stripMd(shadowM[1]) : '—',
      };
    });
    return out;
  }

  function loadCandidateProfiles() {
    if (candidateProfilesPromise) return candidateProfilesPromise;
    candidateProfilesPromise = fetchText(BASE + 'CANDIDATE_PROFILES.md')
      .then(function (md) {
        candidateBackstories = parseCandidateProfilesFromMd(md);
      })
      .catch(function () {
        candidateBackstories = {};
      });
    return candidateProfilesPromise;
  }

  function clampStat(key, v) {
    const max = STAT_MAX[key];
    if (max != null) return Math.max(0, Math.min(max, v));
    return Math.max(0, v);
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem('calix_save_v1');
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o.stats) gameState.stats = Object.assign(gameState.stats, o.stats);
      if (o.inventory) gameState.inventory = o.inventory;
      if (o.currentEpisodeN) gameState.currentEpisodeN = o.currentEpisodeN;
      if (o.candidateName) gameState.candidateName = o.candidateName;
      if (o.candidateArchetype) gameState.candidateArchetype = o.candidateArchetype;
      if (o.candidateBlurb) gameState.candidateBlurb = o.candidateBlurb;
      if (o.episodeChoices && typeof o.episodeChoices === 'object') gameState.episodeChoices = o.episodeChoices;
      if (o.unlockedThrough) gameState.unlockedThrough = o.unlockedThrough;
      if (o.lastGiftMember != null && o.lastGiftMember !== '') gameState.lastGiftMember = o.lastGiftMember;
      if (o.lastGiftEpisode != null && !isNaN(Number(o.lastGiftEpisode))) {
        gameState.lastGiftEpisode = Number(o.lastGiftEpisode);
      }
      if (o.photocardCount != null && !isNaN(Number(o.photocardCount))) {
        gameState.photocardCount = Number(o.photocardCount);
      }
    } catch (e) { /* ignore */ }
  }

  function saveGame() {
    try {
      localStorage.setItem(
        'calix_save_v1',
        JSON.stringify({
          stats: gameState.stats,
          inventory: gameState.inventory,
          currentEpisodeN: gameState.currentEpisodeN,
          candidateName: gameState.candidateName,
          candidateArchetype: gameState.candidateArchetype,
          candidateBlurb: gameState.candidateBlurb,
          episodeChoices: gameState.episodeChoices,
          unlockedThrough: gameState.unlockedThrough,
          lastGiftMember: gameState.lastGiftMember,
          lastGiftEpisode: gameState.lastGiftEpisode,
          photocardCount: gameState.photocardCount,
        })
      );
    } catch (e) { /* ignore */ }
  }

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load ' + url + ' (' + res.status + ')');
    return res.text();
  }

  function parseEpisodesMap(md) {
    const meta = {};
    const re = /### EP (\d+) —[^\n]*\n([\s\S]*?)(?=### EP \d+|$)/g;
    let m;
    while ((m = re.exec(md)) !== null) {
      const n = parseInt(m[1], 10);
      const block = m[2];
      const gateM = block.match(/\*\*Stat Gate:\*\*\s*(.+)/);
      const rewardM = block.match(/\*\*Reward:\*\*\s*(.+)/);
      meta[n] = {
        gate: gateM ? gateM[1].trim() : 'None',
        rewardLine: rewardM ? rewardM[1].trim() : '',
      };
    }
    return meta;
  }

  function parseStatEffectsFromText(text) {
    const deltas = {};
    const flat = String(text).replace(/`([^`]*)`/g, '$1');
    const re = /\[([+-]\d+)\s+([A-Z_a-z ]+)\]/g;
    let m;
    while ((m = re.exec(flat)) !== null) {
      const v = parseInt(m[1], 10);
      const raw = m[2].trim();
      if (/^all members$/i.test(raw)) {
        TRUST_KEYS.forEach(function (k) {
          deltas[k] = (deltas[k] || 0) + v;
        });
      } else {
        const key = raw.replace(/\s+/g, '_').toUpperCase();
        deltas[key] = (deltas[key] || 0) + v;
      }
    }
    return deltas;
  }

  const REACTION_STAT_KEYS = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST', 'GROUP_REP', 'SKILL'];
  const REACTION_STAT_ORDER = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST', 'GROUP_REP', 'SKILL'];
  const REACTION_POS = {
    KAIN_TRUST: "Kain noticed. He won't say it — but he filed that away.",
    THEO_TRUST: "Theo grins. You're already one of his people.",
    JAY_TRUST: "Jay doesn't say anything. But he heard you.",
    FINN_TRUST: 'Finn was watching. He always is.',
    GROUP_REP: 'The group feels it. Something settled.',
    SKILL: "You're getting sharper. It shows.",
  };
  const REACTION_NEG = {
    KAIN_TRUST: "Kain clocked that. He won't forget.",
    THEO_TRUST: "Theo's still warm — but something shifted.",
    JAY_TRUST: 'Jay went quiet. Not the good kind.',
    FINN_TRUST: "Finn noticed. He just won't bring it up.",
    GROUP_REP: 'The room read that. Hard to unsee.',
    SKILL: 'Not your best. Move on.',
  };

  function applyDeltas(deltas) {
    const prev = {};
    Object.keys(gameState.stats).forEach(function (k) {
      prev[k] = gameState.stats[k];
    });
    Object.keys(deltas).forEach(function (k) {
      if (k === 'COINS') {
        gameState.stats.COINS = Math.max(0, gameState.stats.COINS + deltas[k]);
        return;
      }
      if (gameState.stats[k] === undefined) return;
      gameState.stats[k] = clampStat(k, gameState.stats[k] + deltas[k]);
    });
    Object.keys(deltas).forEach(function (k) {
      if (k === 'COINS' || REACTION_STAT_KEYS.indexOf(k) === -1) return;
      episodeChoiceStatDelta[k] = (episodeChoiceStatDelta[k] || 0) + deltas[k];
    });
    saveGame();
    renderStatsSidebar(prev);
  }

  function reactionLineFromEpisodeChoices() {
    var bestK = null;
    var bestV = 0;
    REACTION_STAT_ORDER.forEach(function (k) {
      var v = episodeChoiceStatDelta[k] || 0;
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    });
    if (bestK && bestV > 0) return REACTION_POS[bestK];
    var worstK = null;
    var worstV = 0;
    REACTION_STAT_ORDER.forEach(function (k) {
      var v = episodeChoiceStatDelta[k] || 0;
      if (v < worstV) {
        worstV = v;
        worstK = k;
      }
    });
    if (worstK && worstV < 0) return REACTION_NEG[worstK];
    return 'You held your ground.';
  }

  /** Narrative (before →), plain right side, member, accessory label from EPISODES_MAP reward line. */
  function parseMapRewardParts(mapLine) {
    var out = { narrative: '', rightPlain: '', member: '', accessoryName: '' };
    if (!mapLine || !/→/.test(mapLine)) return out;
    var sides = String(mapLine).split('→');
    var left = sides[0].trim().replace(/^`+/, '').replace(/`+$/, '').trim();
    out.narrative = left;
    var right = sides
      .slice(1)
      .join('→')
      .trim()
      .replace(/\*\*/g, '')
      .trim();
    out.rightPlain = right;
    var fm = right.match(/\(from\s+([^)]+)\)/i);
    if (fm) out.member = fm[1].trim();
    var am = right.match(/accessory:\s*([^(.]+?)\s*(?:\(|$)/i);
    if (am) out.accessoryName = am[1].trim();
    return out;
  }

  function formatRewardPopupTypeLine(typeKey, coins, mapParts) {
    var m = (mapParts.member || '').trim();
    if (typeKey === 'coins') return '🪙 ' + (coins || 0) + ' coins';
    switch (typeKey) {
      case 'drink':
        return '🥤 Drink' + (m ? ' — from ' + m : '');
      case 'snack':
        return '🍪 Snack' + (m ? ' — from ' + m : '');
      case 'candy':
        return '🍬 Candy' + (m ? ' — from ' + m : '');
      case 'photocard':
        return '🃏 Photocard unlocked';
      case 'accessory': {
        var item = (mapParts.accessoryName || '').trim();
        if (!item && mapParts.rightPlain) {
          var rm = mapParts.rightPlain.match(/^Accessory:\s*(.+)$/i);
          if (rm) item = rm[1].replace(/\s*\(from\s+[^)]+\)\s*$/i, '').trim();
        }
        if (!item) item = 'Gift';
        return '✨ ' + item + (m ? ' — from ' + m : '');
      }
      case 'fan_gift':
        return '🎁 Gift from a fan';
      case 'notebook':
        return '📓 Notebook' + (m ? ' — from ' + m : '');
      case 'merch':
        return '🖤 CALIX merch';
      case 'album':
        return '💿 Album';
      default:
        if (coins > 0) return '🪙 ' + coins + ' coins';
        return 'Reward';
    }
  }

  function checkGate(gateStr) {
    return { ok: true, reason: '' };
  }

  /** Remove writer-only script lines; strip ** only on flow beats (not raw md) so choice parsing stays valid. */
  function filterEpisodeScriptForPlayer(md) {
    if (!md || typeof md !== 'string') return md;
    md = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = md.split('\n');
    const kept = [];
    for (let i = 0; i < lines.length; ) {
      if (/^##\s*SCENE DIRECTION NOTES\s*$/i.test(lines[i].trim())) {
        i++;
        while (i < lines.length) {
          const t = lines[i].trim();
          if (t === '---') { i++; break; }
          if (/^##\s/.test(lines[i])) break;
          i++;
        }
        continue;
      }
      kept.push(lines[i]);
      i++;
    }
    md = kept.join('\n');
    const blocks = md.split(/\n{2,}/);
    const filteredBlocks = blocks.filter(function (block) {
      if (/\*\*Act:\*\*/i.test(block)) return false;
      if (/\*\*Featured:\*\*/i.test(block)) return false;
      if (/\*\*Setting:\*\*/i.test(block)) return false;
      return true;
    });
    return filteredBlocks.join('\n\n');
  }

  function stripMarkdownBoldFromFlowQueue(queue) {
    return queue.map(function (beat) {
      if (beat.type === 'narration' || beat.type === 'scene_header') {
        return Object.assign({}, beat, { text: String(beat.text).replace(/\*\*/g, '') });
      }
      if (beat.type === 'dialogue') {
        return Object.assign({}, beat, { text: String(beat.text).replace(/\*\*/g, '') });
      }
      if (beat.type === 'choice') {
        return {
          type: 'choice',
          title: String(beat.title).replace(/\*\*/g, ''),
          options: beat.options.map(function (o) {
            return Object.assign({}, o, {
              label: String(o.label).replace(/\*\*/g, '').replace(/^\*|\*$/g, '').trim(),
              body: String(o.body).replace(/\*\*/g, ''),
            });
          }),
        };
      }
      return beat;
    });
  }

  function splitMarkdownSegments(md) {
    const lines = md.split('\n');
    const segments = [];
    let buf = [];
    let inChoice = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^## CHOICE \d+/i.test(line)) {
        if (buf.length) {
          segments.push({ type: inChoice ? 'choice' : 'story', raw: buf.join('\n') });
          buf = [];
        }
        inChoice = true;
        buf.push(line);
      } else if (inChoice && /^## (SCENE|COLD OPEN|EPISODE END)/i.test(line)) {
        segments.push({ type: 'choice', raw: buf.join('\n') });
        buf = [line];
        inChoice = false;
      } else {
        buf.push(line);
      }
    }
    if (buf.length) {
      segments.push({ type: inChoice ? 'choice' : 'story', raw: buf.join('\n') });
    }
    return segments;
  }

  function parseChoiceBlock(raw) {
    const lines = raw.split('\n');
    const title = lines[0] || '';
    let i = 1;
    const preLines = [];
    while (i < lines.length && !/^\*\*OPTION\s+[A-D]:/i.test(lines[i].trim())) {
      preLines.push(lines[i]);
      i++;
    }
    const preamble = preLines.join('\n');
    const body = lines.slice(i).join('\n');
    const options = [];
    const re = /\*\*OPTION ([A-D]):\*\*\s*([^\n]*)\n([\s\S]*?)(?=\n---|\n\*\*OPTION |$)/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      const key = m[1].toLowerCase();
      const label = m[2].trim();
      const chunk = m[3].trim();
      const effects = parseStatEffectsFromText(chunk);
      options.push({ key: key, label: label, body: chunk, effects: effects });
    }
    return { title: title, preamble: preamble, options: options };
  }

  function stripQuotes(s) {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('"') && s.endsWith('"'))) {
      return s.slice(1, -1).replace(/\n/g, '\n');
    }
    return s;
  }

  function storySegmentToBeats(raw) {
    const q = [];
    const lines = raw.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) {
        i++;
        continue;
      }
      if (/^#\s/.test(t) && !/^##\s/.test(t)) {
        i++;
        continue;
      }
      if (/^##\s*EPISODE\s*END/i.test(t)) break;
      if (/^##\s*CHOICE\s*\d+/i.test(t)) break;

      if (/^##\s*(SCENE|COLD OPEN|SCENE DIRECTION)/i.test(t) || /^##\s*SCENE\b/i.test(t)) {
        q.push({ type: 'scene_header', text: t.replace(/^##\s+/, '').trim() });
        i++;
        continue;
      }

      if (t === '---') {
        q.push({ type: 'separator' });
        i++;
        continue;
      }

      if (/^\*\*NARRATION:\*\*/i.test(line)) {
        i++;
        let narr = '';
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          narr += lines[i].replace(/^\s*>\s?/, '') + '\n';
          i++;
        }
        if (narr.trim()) q.push({ type: 'narration', text: narr.trim() });
        continue;
      }

      const headInline = line.match(/^\*\*([^*]+):\*\*\s+(.+)$/);
      if (headInline && !/^narration$/i.test(headInline[1].trim())) {
        const sp = headInline[1].trim().toUpperCase();
        let txt = headInline[2].trim().replace(/^>\s?/, '');
        if (txt) {
          q.push({ type: 'dialogue', speaker: sp, text: stripQuotes(txt.replace(/^["']|["']$/g, '')) || txt });
        }
        i++;
        continue;
      }

      const head = line.match(/^\*\*([^*]+):\*\*\s*$/);
      if (head) {
        const speaker = head[1].trim();
        i++;
        if (/^narration$/i.test(speaker)) {
          let narr = '';
          while (i < lines.length && /^\s*>/.test(lines[i])) {
            narr += lines[i].replace(/^\s*>\s?/, '') + '\n';
            i++;
          }
          if (narr.trim()) q.push({ type: 'narration', text: narr.trim() });
          continue;
        }

        while (i < lines.length) {
          const L = lines[i];
          const tr = L.trim();
          if (/^\*\*[^*]+:\*\*/.test(tr)) break;
          if (/^##\s/.test(tr)) break;
          if (/^\*\*OPTION\s+[A-D]:/i.test(tr)) break;
          if (tr === '---') break;

          if (/^\*[^*].*\*$/.test(tr) && !tr.startsWith('**')) {
            q.push({ type: 'narration', text: tr.slice(1, -1) });
            i++;
            continue;
          }

          if (/^\s*>/.test(L)) {
            let narr = [];
            while (i < lines.length && /^\s*>/.test(lines[i])) {
              narr.push(lines[i].replace(/^\s*>\s?/, ''));
              i++;
            }
            const nt = narr.join('\n').trim();
            if (nt) q.push({ type: 'narration', text: nt });
            continue;
          }

          if (!tr) {
            i++;
            continue;
          }

          const parts = [];
          while (i < lines.length) {
            const L2 = lines[i];
            const t2 = L2.trim();
            if (!t2) {
              parts.push(L2);
              i++;
              continue;
            }
            if (/^\*\*[^*]+:\*\*/.test(t2)) break;
            if (/^##\s/.test(t2)) break;
            if (/^\*\*OPTION\s+[A-D]:/i.test(t2)) break;
            if (t2 === '---') break;
            if (/^\*[^*].*\*$/.test(t2) && !t2.startsWith('**')) break;
            if (/^\s*>/.test(L2)) break;
            parts.push(L2);
            i++;
          }
          let text = parts.join('\n').trim().replace(/^>\s?/gm, '').trim();
          if (text) {
            q.push({
              type: 'dialogue',
              speaker: speaker.toUpperCase(),
              text: stripQuotes(text.replace(/^["']|["']$/g, '')) || text,
            });
          }
        }
        continue;
      }

      if (t.startsWith('*') && t.endsWith('*') && t.length > 2 && !t.startsWith('**')) {
        q.push({ type: 'narration', text: t.slice(1, -1) });
        i++;
        continue;
      }

      if (t.startsWith('*') && !t.startsWith('**')) {
        let st = t;
        i++;
        while (i < lines.length) {
          const L = lines[i].trim();
          if (!L || L.startsWith('**') || L.startsWith('##')) break;
          if (L.startsWith('*') && L.endsWith('*') && L.length > 2) {
            st += '\n' + L.slice(1, -1);
            i++;
            break;
          }
          st += '\n' + L;
          i++;
        }
        q.push({ type: 'narration', text: st.replace(/^\*|\*$/g, '').replace(/\*$/g, '').trim() });
        continue;
      }

      if (/^\s*>/.test(line)) {
        let narr = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          narr.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        const nt = narr.join('\n').trim();
        if (nt) q.push({ type: 'narration', text: nt });
        continue;
      }

      if (/^\*\*OPTION\s+[A-D]:/i.test(line)) break;

      i++;
    }
    return q;
  }

  function stripStatTags(s) {
    return String(s)
      .replace(/`[^`]*`/g, '')
      .replace(/\[([+-]\d+)\s+[A-Za-z_\s]+\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function unwrapChoiceBody(body) {
    return body.split('\n').map(function (ln) {
      if (/^\s*>/.test(ln)) return ln.replace(/^\s*>\s?/, '');
      return ln;
    }).join('\n');
  }

  function classifyRewardType(rewardLine, itemLabel, coins) {
    const blob = ((rewardLine || '') + ' ' + (itemLabel || '')).toLowerCase();
    const mapLine = rewardLine || '';
    const hasMapArrow = /→/.test(mapLine);
    const mapLooksCoinOnly = !hasMapArrow && /\d+\s*coins?/i.test(mapLine);
    if (mapLooksCoinOnly || (!hasMapArrow && coins > 0 && (!itemLabel || /coins?/.test(blob)))) {
      return { key: 'coins', label: 'Coins' };
    }
    if (/\bphotocard|photo[\s-]?card|polaroid\b|\bprint\b/.test(blob)) return { key: 'photocard', label: 'Photocard' };
    if (/\bdrink\b|\bcoffee\b|\blatte\b|\btea\b|\bsoda\b|\bjuice\b|\bwater\b|water bottle|energy drink/.test(blob))
      return { key: 'drink', label: 'Drink' };
    if (/\bcandy\b|candy bar/.test(blob)) return { key: 'candy', label: 'Candy' };
    if (/\bfan\s+gift\b/.test(blob)) return { key: 'fan_gift', label: 'Fan gift' };
    if (/\bnotebook\b/.test(blob)) return { key: 'notebook', label: 'Notebook' };
    if (/\bsnack\b|\bchips\b|\bfood\b|\btreat\b/.test(blob)) return { key: 'snack', label: 'Snack' };
    if (/\bhoodie\b|\bcap\b|\bbeanie\b|\bmerch\b/.test(blob)) return { key: 'merch', label: 'Merch' };
    if (/\balbum\b/.test(blob)) return { key: 'album', label: 'Album' };
    if (/\baccessory\b|\bcharm\b|\bkeychain\b|\bhat\b|\bearring\b|\bnecklace\b|\bpendant\b|\bwristband\b|\bbracelet\b|\bring\b/.test(blob)) {
      return { key: 'accessory', label: 'Accessory' };
    }
    if (itemLabel) return { key: 'item', label: 'Item' };
    return { key: 'coins', label: coins > 0 ? 'Coins' : 'Reward' };
  }

  function parseRewardFromScript(md) {
    const m = md.match(/\*\*Reward unlocked:\*\*\s*`([^`]+)`/i);
    if (!m) return { coins: 0, itemLabel: null };
    const inner = m[1];
    const c = inner.match(/(\d+)\s*coins?/i);
    const coins = c ? parseInt(c[1], 10) : 0;
    let itemLabel = null;
    if (/→/.test(inner)) {
      itemLabel = inner.split('→').pop().trim();
    } else if (!coins && inner) itemLabel = inner;
    return { coins: coins, itemLabel: itemLabel };
  }

  function clearSceneStream() {
    const el = document.getElementById('scene-stream');
    if (el) el.innerHTML = '';
    lastNarrationFp = '';
    lastDialogueDedup = '';
    newMemberInject = { theo: false, kain: false, narr: false };
    firstAddressPrefixBySpeaker = {};
    episodeSpeakerRunningCount = { KAIN: 0, THEO: 0, JAY: 0, FINN: 0 };
  }

  window.episodeLockedContinue = function () {
    if (typeof go === 'function') go(6);
    if (typeof window.initReward === 'function') window.initReward();
  };

  function renderPaywall() {
    clearSceneStream();
    const stream = document.getElementById('scene-stream');
    if (!stream) return;
    stream.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;padding:2rem;text-align:center;gap:1.2rem;">' +
      '<div style="font-size:2.4rem;">🔒</div>' +
      '<h2 style="font-family:\'Playfair Display\',serif;font-size:1.6rem;color:#977DFF;margin:0;">Episode ' + PAYWALL_EPISODE + ' and beyond</h2>' +
      '<p style="color:#c8b8ff;font-size:0.97rem;max-width:320px;line-height:1.6;margin:0;">' +
      'Episodes 1–3 are free.<br>Unlock the full CALIX story — all 30 episodes, every ending, every heart-flutter moment.' +
      '</p>' +
      '<div style="background:rgba(151,125,255,0.08);border:1px solid rgba(151,125,255,0.25);border-radius:12px;padding:1rem 1.4rem;max-width:300px;">' +
      '<div style="color:#fff;font-size:0.85rem;line-height:1.8;">' +
      '✦ 27 more episodes<br>' +
      '✦ All 4 member endings<br>' +
      '✦ Exclusive photocards &amp; rewards<br>' +
      '✦ One-time purchase · No subscription' +
      '</div>' +
      '</div>' +
      '<button type="button" onclick="calixRequestPurchase()" style="background:linear-gradient(135deg,#977DFF,#6B4FD8);color:#fff;border:none;border-radius:999px;padding:0.85rem 2.2rem;font-size:1rem;font-weight:600;cursor:pointer;letter-spacing:0.03em;box-shadow:0 0 24px rgba(151,125,255,0.4);">Unlock Full Story</button>' +
      '<button type="button" onclick="episodeLockedContinue()" style="background:transparent;color:#977DFF;border:none;font-size:0.85rem;cursor:pointer;text-decoration:underline;">← Back to overview</button>' +
      '</div>';
  }

  function renderEpisodeLocked(reason) {
    clearSceneStream();
    const stream = document.getElementById('scene-stream');
    if (stream) {
      stream.innerHTML =
        '<div class="episode-locked-panel" role="status">' +
        '<svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
        '<rect x="5" y="11" width="14" height="10" rx="2"/>' +
        '<path d="M8 11V8a4 4 0 0 1 8 0v3"/>' +
        '</svg>' +
        '<p class="lock-title">Episode locked</p>' +
        '<p class="lock-body">' +
        escapeHtml(reason) +
        '</p>' +
        '<button type="button" class="episode-back-btn" onclick="episodeLockedContinue()">Back to overview →</button>' +
        '</div>';
    }
  }

  function syncEpisodeHud() {
    const c = document.getElementById('ep-coins');
    if (c) c.textContent = gameState.stats.COINS + ' coins';
  }

  function renderStatsSidebar(prevStatsOptional) {
    const s = gameState.stats;
    function bar(key, cls, label) {
      const max = STAT_MAX[key] || 15;
      const pct = max ? (Math.min(s[key], max) / max) * 100 : 0;
      const flash =
        prevStatsOptional &&
        prevStatsOptional[key] !== undefined &&
        prevStatsOptional[key] !== s[key];
      return (
        '<div class="sb-row" data-stat-row="' +
        key +
        '">' +
        '<div class="stat-label' +
        (flash ? ' stat-label-flash' : '') +
        '">' +
        label +
        '</div>' +
        '<div class="stat-bar-track"><div class="stat-bar-fill ' +
        cls +
        '" style="width:' +
        pct +
        '%"></div></div>' +
        '<div class="sb-val">' +
        s[key] +
        '/' +
        max +
        '</div></div>'
      );
    }

    const html =
      bar('KAIN_TRUST', 'stat-kain', 'Kain') +
      bar('THEO_TRUST', 'stat-theo', 'Theo') +
      bar('JAY_TRUST', 'stat-jay', 'Jay') +
      bar('FINN_TRUST', 'stat-finn', 'Finn') +
      bar('GROUP_REP', 'stat-rep', 'Group rep') +
      bar('SKILL', 'stat-skill', 'Skill') +
      '<div class="sb-coins"><span class="coin-label">Coins</span><span class="coin-val">' +
      s.COINS +
      '</span></div>';

    const side = document.getElementById('stats-sidebar-body');
    if (side) side.innerHTML = html;

    if (side && prevStatsOptional) {
      var floatKeys = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST', 'GROUP_REP', 'SKILL'];
      floatKeys.forEach(function (key) {
        if (prevStatsOptional[key] === undefined) return;
        var delta = s[key] - prevStatsOptional[key];
        if (delta === 0) return;
        var row = side.querySelector('[data-stat-row="' + key + '"]');
        if (!row) return;
        var rect = row.getBoundingClientRect();
        var floater = document.createElement('span');
        floater.className = 'stat-delta-float ' + (delta > 0 ? 'stat-delta-pos' : 'stat-delta-neg');
        floater.textContent = (delta > 0 ? '+' : '') + delta;
        floater.style.left = (rect.right - 28) + 'px';
        floater.style.top = (rect.top + 2) + 'px';
        document.body.appendChild(floater);
        setTimeout(function () { if (floater.parentNode) floater.parentNode.removeChild(floater); }, 1300);
      });
    }

    const invEl = document.getElementById('inventory-list');
    if (invEl) {
      if (!gameState.inventory.length) {
        invEl.innerHTML = '<p class="inv-empty">No items yet.</p>';
      } else {
        invEl.innerHTML = gameState.inventory
          .map(function (it) {
            return '<div class="inv-item">' + escapeHtml(it.name) + '</div>';
          })
          .join('');
      }
    }
    syncEpisodeHud();

    if (prevStatsOptional && prevStatsOptional.COINS !== undefined && prevStatsOptional.COINS !== s.COINS) {
      const coinLab = document.querySelector('.sb-coins .coin-label');
      if (coinLab) {
        coinLab.classList.add('stat-label-flash');
        setTimeout(function () {
          coinLab.classList.remove('stat-label-flash');
        }, 800);
      }
    }

    if (prevStatsOptional) {
      setTimeout(function () {
        document.querySelectorAll('.stat-label-flash').forEach(function (el) {
          el.classList.remove('stat-label-flash');
        });
      }, 850);
    }
  }

  /** If the string is all caps (typical markdown), convert to sentence case for display. */
  function toSentenceCase(s) {
    var t = String(s).trim();
    if (!t) return t;
    if (t.length > 1 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      var lower = t.toLowerCase();
      return lower.replace(/(^|[.!?]\s+)([a-z])/g, function (_m, a, b) {
        return a + b.toUpperCase();
      });
    }
    return t;
  }

  function candidateRawFromStorage() {
    var raw = (gameState.candidateName && String(gameState.candidateName).trim()) || '';
    if (raw) return raw;
    try {
      var ls = localStorage.getItem('calix_save_v1');
      if (!ls) return '';
      var o = JSON.parse(ls);
      if (o.candidateName) return String(o.candidateName).trim();
    } catch (e) {}
    return '';
  }

  function candidateDisplayName() {
    var raw = candidateRawFromStorage();
    if (!raw) return 'you';
    return toSentenceCase(raw);
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Possessive contraction for "they are" → candidate name + "'s" with sentence-case cap when needed. */
  function namePossessiveTheyre(atSentenceStart) {
    var display = candidateDisplayName();
    if (display === 'you') return "you're";
    return (atSentenceStart ? display.charAt(0).toUpperCase() + display.slice(1) : display) + "'s";
  }

  /** Member lines clearly addressing the POV / 5th member (first line of a dialogue beat). */
  function isDirectAddressToFifthOpening(line, speaker) {
    var s = String(line).trim();
    if (!s) return false;
    if (speaker === 'THEO' && /^You're being\b/i.test(s)) return false;
    if (/^(You\b|Your\b)/i.test(s)) return true;
    if (/^(Come in\b|Come on —)/i.test(s)) return true;
    if (
      /\b(you're here|you good\?|you look|you've been|you don't have to|you could|you need|you've been briefed)\b/i.test(
        s
      )
    )
      return true;
    if (/^(Oh|Hi|Hey|So|Wait|Um|Hmm|Okay|OK)[, —\s].*\b(you're|you |your)\b/is.test(s)) return true;
    return false;
  }

  /** When another member is addressed and "they're" refers to the 5th member (e.g. "Kain, they're here"). */
  function replaceTheyReferringToFifthMember(t, speaker) {
    if (!MEMBER_SPEAKERS[speaker]) return t;
    var display = candidateDisplayName();
    if (display === 'you') return t;
    var out = String(t);
    out = out.replace(/\bthem like they're\b/gi, display + ' like ' + display + "'s");
    out = out.replace(/,\s*they're\b/g, ', ' + display + "'s");
    out = out.replace(/\bThey're finally\b/g, namePossessiveTheyre(true));
    out = out.replace(/\bthey're finally\b/g, namePossessiveTheyre(false));
    out = out.replace(/\bThey're here\b/g, namePossessiveTheyre(true));
    out = out.replace(/\bthey're here\b/g, namePossessiveTheyre(false));
    out = out.replace(/\bThey're in the room\b/g, namePossessiveTheyre(true));
    out = out.replace(/\bthey're in the room\b/g, namePossessiveTheyre(false));
    return out;
  }

  /** First time in this scene this speaker addresses the 5th member: "Name, …" on the opening line. */
  function maybePrefixFirstAddressToFifth(text, speaker) {
    if (!MEMBER_SPEAKERS[speaker]) return text;
    var display = candidateDisplayName();
    if (display === 'you') return text;
    if (firstAddressPrefixBySpeaker[speaker]) return text;
    var lines = String(text)
      .split('\n')
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    if (!lines.length) return text;
    var first = lines[0];
    if (new RegExp('^' + escapeRegExp(display) + ',\\s', 'i').test(first)) {
      firstAddressPrefixBySpeaker[speaker] = true;
      return text;
    }
    if (!isDirectAddressToFifthOpening(first, speaker)) return text;
    firstAddressPrefixBySpeaker[speaker] = true;
    lines[0] = display + ', ' + (first.charAt(0).toLowerCase() + first.slice(1));
    return lines.join('\n');
  }

  function syncNavIdentity() {
    var badge = document.querySelector('.nav-identity-badge');
    if (!badge) return;
    var display = candidateDisplayName();
    badge.innerHTML =
      '<span id="nav-identity-name"><strong>' +
      escapeHtml(display) +
      '</strong></span>';
  }

  function applyCandidateToEpisodeText(text, beatType, speaker) {
    var display = candidateDisplayName();
    var t = String(text);
    t = t.replace(/\[(CANDIDATE|NAME|5TH)\]/gi, display);
    if (/(?<!\bnot )\bthe new member(?:'s)?\b/i.test(t)) {
      var doReplace = false;
      if (beatType === 'dialogue' && speaker === 'THEO' && !newMemberInject.theo) {
        newMemberInject.theo = true;
        doReplace = true;
      } else if (beatType === 'dialogue' && speaker === 'KAIN' && !newMemberInject.kain) {
        newMemberInject.kain = true;
        doReplace = true;
      } else if (beatType === 'narration' && !newMemberInject.narr) {
        newMemberInject.narr = true;
        doReplace = true;
      }
      if (doReplace) {
        t = t.replace(/(?<!\bnot )\bthe new member's\b/gi, display + "'s");
        t = t.replace(/(?<!\bnot )\bthe new member\b/gi, display);
      }
    }
    if (beatType === 'dialogue' && speaker && MEMBER_SPEAKERS[speaker]) {
      t = replaceTheyReferringToFifthMember(t, speaker);
      t = maybePrefixFirstAddressToFifth(t, speaker);
    }
    return t;
  }

  function textFingerprint(s) {
    return String(s)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 96);
  }

  function splitSentences(text) {
    const t = String(text)
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return [];
    return t.split(/(?<=[.!?])\s+/).filter(Boolean);
  }

  function trimNarrationForReader(raw) {
    const sens = splitSentences(raw);
    if (!sens.length) return '';
    return sens.slice(0, 2).join(' ');
  }

  function trimDialogueForReader(raw) {
    const t = String(raw).trim();
    const lines = t
      .split(/\n+/)
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean);
    if (lines.length >= 2) return lines.slice(0, 3).join('\n');
    const sens = splitSentences(t);
    if (sens.length <= 3) return sens.join(' ');
    return sens.slice(0, 3).join(' ');
  }

  function appendStreamBlock(html, className) {
    const stream = document.getElementById('scene-stream');
    if (!stream) return null;
    const wrap = document.createElement('div');
    wrap.className = (className || '') + ' episode-stream-block';
    wrap.innerHTML = html;
    stream.appendChild(wrap);
    return wrap;
  }

  function appendOneBeatToStream(beat) {
    if (beat.type === 'member_reaction') {
      appendStreamBlock('<div class="member-reaction"><span class="mr-name">' + escapeHtml(beat.member) + '</span><span class="mr-text">"' + escapeHtml(beat.reaction) + '"</span></div>', '');
      return;
    }

    if (beat.type === 'narration') {
      const injected = applyCandidateToEpisodeText(beat.text, 'narration', null);
      const trimmed = trimNarrationForReader(injected);
      if (!trimmed) return;
      const fp = textFingerprint(trimmed);
      if (fp === lastNarrationFp) return;
      lastNarrationFp = fp;
      appendStreamBlock(
        '<div class="narration">' + escapeHtml(trimmed).replace(/\n/g, '<br>') + '</div>',
        ''
      );
      return;
    }

    if (beat.type === 'scene_header') {
      lastNarrationFp = '';
      lastDialogueDedup = '';
      firstAddressPrefixBySpeaker = {};
      appendStreamBlock('<div class="scene-break">' + escapeHtml(beat.text) + '</div>', '');
      return;
    }

    if (beat.type === 'separator') {
      return;
    }

    if (beat.type === 'dialogue') {
      const injected = applyCandidateToEpisodeText(beat.text, 'dialogue', beat.speaker);
      const trimmed = trimDialogueForReader(injected);
      if (!trimmed) return;
      const dk = beat.speaker + '|' + textFingerprint(trimmed);
      if (dk === lastDialogueDedup) return;
      lastDialogueDedup = dk;
      if (episodeSpeakerRunningCount.hasOwnProperty(beat.speaker)) episodeSpeakerRunningCount[beat.speaker]++;
      lastNarrationFp = '';
      appendStreamBlock(
        '<div class="character-name">' +
          escapeHtml(beat.speaker) +
          '</div><div class="dialogue-text">' +
          '\u201C' + escapeHtml(trimmed).replace(/\n/g, '<br>') + '\u201D' +
          '</div>',
        'dialogue-box'
      );
    }
  }

  function flushContinuousSegment() {
    while (flowIdx < flowQueue.length) {
      const beat = flowQueue[flowIdx];
      if (beat.type === 'choice') {
        renderChoiceInline(beat);
        return;
      }
      appendOneBeatToStream(beat);
      flowIdx++;
    }
    const stream = document.getElementById('scene-stream');
    if (stream) {
      const endBtn = document.createElement('button');
      endBtn.className = 'btn-solid choice-btn';
      endBtn.style.marginTop = '2rem';
      endBtn.textContent = 'Continue →';
      endBtn.onclick = function() {
        endBtn.remove();
        endEpisodeFlow();
      };
      stream.appendChild(endBtn);
    }
  }

  function renderChoiceInline(beat) {
    const stream = document.getElementById('scene-stream');
    if (!stream) return;

    const section = document.createElement('div');
    section.className = 'choice-inline-section';

    const prompt = document.createElement('p');
    prompt.className = 'episode-prompt';
    prompt.textContent = toSentenceCase(
      beat.title.replace(/^##\s*CHOICE\s*\d+\s*[—-]\s*/i, '').trim() || 'Choose'
    );

    const bar = document.createElement('div');
    bar.className = 'choice-bar choice-bar--sticky';

    // 결정론적 페이크 퍼센트: 에피소드+블록 인덱스 시드 기반, 항상 같은 값 반환
    function getFakeChoicePercents(epN, blockIdx, numOptions) {
      function seededRand(seed) {
        var x = Math.sin(seed + 1) * 10000;
        return x - Math.floor(x);
      }
      var weights = [];
      for (var i = 0; i < numOptions; i++) {
        var base = seededRand(epN * 97 + blockIdx * 31 + i * 13);
        weights.push(0.1 + base * 0.9);
      }
      var total = weights.reduce(function(a, b) { return a + b; }, 0);
      var percents = weights.map(function(w) { return Math.round(w / total * 100); });
      var diff = 100 - percents.reduce(function(a, b) { return a + b; }, 0);
      percents[0] += diff;
      return percents;
    }

    var choicePercents = getFakeChoicePercents(
      gameState.currentEpisodeN,
      choiceBlockIdx++,
      beat.options.length
    );

    beat.options.forEach(function (opt, optIdx) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = toSentenceCase(stripStatTags(opt.label) || opt.label);
      btn.onclick = function () {
        applyDeltas(opt.effects);

        // stat delta pills in scene stream
        var STAT_LBL = { KAIN_TRUST:'Kain', THEO_TRUST:'Theo', JAY_TRUST:'Jay', FINN_TRUST:'Finn', GROUP_REP:'Group', SKILL:'Skill', COINS:'Coins' };
        if (opt.effects && Object.keys(opt.effects).length) {
          var pillHtml = '';
          Object.keys(opt.effects).forEach(function(k) {
            var v = opt.effects[k];
            if (!v) return;
            var lbl = STAT_LBL[k] || k;
            pillHtml += '<span class="csd-pill ' + (v > 0 ? 'csd-pos' : 'csd-neg') + '">' + (v > 0 ? '+' : '') + v + ' ' + lbl + '</span>';
          });
          if (pillHtml) appendStreamBlock('<div class="choice-stat-delta">' + pillHtml + '</div>', '');
        }

        const epk = String(gameState.currentEpisodeN);
        if (!gameState.episodeChoices[epk]) gameState.episodeChoices[epk] = [];
        gameState.episodeChoices[epk].push({ key: opt.key, label: stripStatTags(opt.label) });
        saveGame();
        var myPct = choicePercents[optIdx];
        bar.innerHTML =
          '<p class="choice-picked">Selected · ' +
          escapeHtml(toSentenceCase(stripStatTags(opt.label) || opt.label)) +
          '</p>' +
          '<p class="choice-stat-pct">' + myPct + '% of players made the same choice</p>';

        // 멤버 반응 — featured 멤버 감지 후 효과 기반으로 반응 선택
        // 감정적으로 무거운 에피소드에서는 반응 억제 (분위기 깨짐 방지)
        var NO_REACTION_EPS = [19, 29, 30];
        var MEMBER_REACTIONS = {
          // Kain: 트러스트 레벨에 따라 다른 반응 — 차갑게 시작해서 점점 진심으로
          KAIN: (function() {
            var kt = gameState.stats.KAIN_TRUST || 0;
            if (kt >= 10) return {
              positive: ['I see you.', 'That was the right call.', '...yeah.', 'Keep that.', 'Good. Really.'],
              negative: ['Not this time.', '...we\'ll fix it.', 'I know you can do better than that.']
            };
            if (kt >= 6) return {
              positive: ['Good.', 'Faster than I expected.', 'Noted.', 'That works.'],
              negative: ['Do better.', 'Again.', '...']
            };
            return {
              positive: ['...', 'Noted.', 'Good.'],
              negative: ['...', 'Do better.', 'Again.']
            };
          })(),
          // Theo: 진심으로 warm하고 빠름 — 하지만 performance 아님, 실제로 저렇게 느끼는 것
          THEO: {
            positive: ['Okay — that landed.', 'I knew it.', 'Yes.', 'That one was you.', 'Okay I\'m not mad about that.'],
            negative: ['...that\'s not — okay.', 'I\'m not going to say anything.', 'We\'ll figure it out.']
          },
          // Jay: 말이 적고 직접적 — 칭찬도 짧고, 비판도 짧음. 감정 표현 안 함
          JAY: {
            positive: ['Solid.', '...respect.', 'Yeah.', 'That worked.'],
            negative: ['Nah.', '...', 'Wrong move.']
          },
          // Finn: 관찰하는 사람 — 모든 걸 알아챔. 놀라지 않음. 말이 정확함
          FINN: {
            positive: ['I noticed.', 'That was the right one.', 'That one mattered.', '...yeah.'],
            negative: ['That wasn\'t it.', '...okay.', 'Not that one.']
          }
        };

        // 지금까지 가장 많이 말한 멤버
        var featuredMember = null;
        var topRunCount = 0;
        Object.keys(episodeSpeakerRunningCount).forEach(function(k) {
          if (episodeSpeakerRunningCount[k] > topRunCount) { topRunCount = episodeSpeakerRunningCount[k]; featuredMember = k; }
        });

        // 효과가 긍정인지 판단 (주요 스탯 증가 여부)
        var isPositive = true;
        if (opt.effects) {
          var vals = Object.values(opt.effects);
          if (vals.length && vals.every(function(v) { return v <= 0; })) isPositive = false;
        }

        // 선택지 본문에 이미 featured 멤버 대사가 있으면 리액션 생략
        // 또는 감정적으로 무거운 에피소드는 리액션 억제
        var bodyAlreadyHasMember = featuredMember && opt.body &&
          new RegExp('\\*\\*' + featuredMember + '\\b', 'i').test(opt.body);
        var isHeavyEpisode = NO_REACTION_EPS.indexOf(gameState.currentEpisodeN) !== -1;

        var sub = storySegmentToBeats(unwrapChoiceBody(opt.body));
        var tail = flowQueue.slice(flowIdx + 1);
        if (featuredMember && MEMBER_REACTIONS[featuredMember] && !bodyAlreadyHasMember && !isHeavyEpisode) {
          var pool = isPositive
            ? MEMBER_REACTIONS[featuredMember].positive
            : MEMBER_REACTIONS[featuredMember].negative;
          var reaction = pool[Math.floor(Math.random() * pool.length)];
          var reactionBeat = {
            type: 'member_reaction',
            member: featuredMember.charAt(0) + featuredMember.slice(1).toLowerCase(),
            reaction: reaction
          };
          // 반응은 선택지 본문이 끝난 후에 — 앞에 붙이면 동문서답이 됨
          flowQueue = sub.concat([reactionBeat]).concat(tail);
        } else {
          flowQueue = sub.concat(tail);
        }

        flowIdx = 0;
        lastNarrationFp = '';
        lastDialogueDedup = '';
        flushContinuousSegment();
      };
      bar.appendChild(btn);
    });

    section.appendChild(prompt);
    section.appendChild(bar);

    var saveExit = document.createElement('div');
    saveExit.className = 'save-exit-wrap';
    saveExit.innerHTML = '<button class="save-exit-btn" onclick="saveGame();window.location.href=\'index.html\'">save & exit</button>';
    section.appendChild(saveExit);

    stream.appendChild(section);
  }

  function endEpisodeFlow() {
    // Determine which member had the most dialogue this episode
    var speakerCount = { KAIN: 0, THEO: 0, JAY: 0, FINN: 0 };
    flowQueue.forEach(function(beat) {
      if (beat.type === 'dialogue' && speakerCount.hasOwnProperty(beat.speaker)) {
        speakerCount[beat.speaker]++;
      }
    });
    var topMember = null, topCount = 0;
    Object.keys(speakerCount).forEach(function(k) {
      if (speakerCount[k] > topCount) { topCount = speakerCount[k]; topMember = k; }
    });
    episodeFeaturedMember = topMember;

    const md = window.__calixLastEpisodeMd || '';
    const parsed = parseRewardFromScript(md);
    const mapLine =
      (episodesMapMeta[gameState.currentEpisodeN] && episodesMapMeta[gameState.currentEpisodeN].rewardLine) || '';
    const cls = classifyRewardType(mapLine, parsed.itemLabel, parsed.coins);
    const rewardName =
      mapLine.replace(/\b\d+\s*coins?\b/gi, '').replace(/^[,\s]+|[,\s]+$/g, '').trim() ||
      parsed.itemLabel ||
      (parsed.coins ? parsed.coins + ' coins' : 'Episode reward');

    pendingReward = {
      coins: parsed.coins,
      itemLabel: parsed.itemLabel,
      rewardName: rewardName,
      typeKey: cls.key,
      typeLabel: cls.label,
    };

    if (pendingReward.coins) {
      const prev = {};
      Object.keys(gameState.stats).forEach(function (k) {
        prev[k] = gameState.stats[k];
      });
      var COIN_POOL = [50, 60, 80, 100, 120];
      pendingReward.coins = COIN_POOL[Math.floor(Math.random() * COIN_POOL.length)];
      gameState.stats.COINS += pendingReward.coins;
      saveGame();
      renderStatsSidebar(prev);
    }
    if (pendingReward.itemLabel && !/coins?/i.test(pendingReward.itemLabel)) {
      gameState.inventory.push({
        name: pendingReward.itemLabel,
        ep: gameState.currentEpisodeN,
        type: cls.key,
      });
    }

    gameState.unlockedThrough = Math.max(gameState.unlockedThrough || 1, gameState.currentEpisodeN + 1);
    saveGame();
    if (!pendingReward.coins) renderStatsSidebar();

    // Google Analytics: episode complete tracking
    if (typeof gtag === 'function') {
      gtag('event', 'episode_complete', {
        episode_number: gameState.currentEpisodeN,
        episode_label: 'ep' + String(gameState.currentEpisodeN).padStart(2, '0')
      });
    }

    // Cloud save (Firebase)
    if (typeof window.calixCloudSave === 'function') window.calixCloudSave();

    showRewardPopup();
  }

  function showRewardPopup() {
    const ov = document.getElementById('reward-popup');
    if (!ov) return;
    const typeEl = document.getElementById('rw-popup-type');
    const lineEl = document.getElementById('rw-popup-line');
    const mapLine =
      (episodesMapMeta[gameState.currentEpisodeN] && episodesMapMeta[gameState.currentEpisodeN].rewardLine) || '';
    const mapParts = parseMapRewardParts(mapLine);
    if (typeEl) {
      if (pendingReward.typeKey === 'photocard') {
        const PHOTOCARD_IMAGES = {
          6: 'Images/08_Photocards/Kain_Photocard.png',
          8: 'Images/08_Photocards/Four_Photocard.png',
          28: 'Images/08_Photocards/Sydney_Photocard.webp',
        };
        const imgSrc = PHOTOCARD_IMAGES[gameState.currentEpisodeN] ||
          'https://picsum.photos/seed/calix-card-' + gameState.currentEpisodeN + '/300/400';
        typeEl.innerHTML = '<img src="' + imgSrc + '" alt="Photocard" class="rw-photocard-img">';
        gameState.photocardCount += 1;
        saveGame();
      } else if (pendingReward.typeKey === 'accessory') {
        var accName = (mapParts.accessoryName || pendingReward.itemLabel || 'Accessory').trim();
        var accMember = (mapParts.member || '').trim();
        var GIFT_IMAGES = {
          14: 'Images/03_Gifts/EP14_Perfumebox.png',
          16: 'Images/03_Gifts/EP16_Earring.png',
          19: 'Images/03_Gifts/EP19_Necklace.png',
          20: 'Images/03_Gifts/EP20_Band.png',
          21: 'Images/03_Gifts/EP21_Ring.png',
          22: 'Images/03_Gifts/EP22_Necklace.png',
          29: 'Images/03_Gifts/EP29_Bracelet.png',
        };
        var accImg = GIFT_IMAGES[gameState.currentEpisodeN] ||
          'https://picsum.photos/seed/calix-acc-' + accName.toLowerCase().replace(/\s+/g, '-') + '/300/400';
        var accCaption = accName + (accMember ? ' — from ' + accMember : '');
        typeEl.innerHTML =
          '<img src="' + accImg + '" alt="' + escapeHtml(accName) + '" class="rw-photocard-img">' +
          '<p class="rw-accessory-label">' + escapeHtml(accCaption) + '</p>';
      } else if (pendingReward.typeKey === 'fan_gift') {
        var fgName = (pendingReward.itemLabel || mapParts.rightPlain || 'Gift').replace(/fan\s+gift/i, '').trim();
        if (!fgName) fgName = 'Gift';
        var fgImg = 'Images/03_Gifts/EP14_Perfumebox.png';
        typeEl.innerHTML =
          '<img src="' + fgImg + '" alt="' + escapeHtml(fgName) + '" class="rw-photocard-img">' +
          '<p class="rw-accessory-label">Gift from a fan</p>';
      } else if (pendingReward.typeKey === 'merch') {
        var MERCH_IMAGES = {
          12: 'Images/06_Merch/EP12_Hoodie.png',
          24: 'Images/06_Merch/EP24_Cap.png',
        };
        var merchImg = MERCH_IMAGES[gameState.currentEpisodeN] ||
          'https://picsum.photos/seed/calix-merch-' + gameState.currentEpisodeN + '/300/400';
        var merchLabel = gameState.currentEpisodeN === 24 ? 'CALIX logo cap' : 'CALIX logo hoodie';
        typeEl.innerHTML =
          '<img src="' + merchImg + '" alt="' + escapeHtml(merchLabel) + '" class="rw-photocard-img">' +
          '<p class="rw-accessory-label">' + escapeHtml(merchLabel) + '</p>';
      } else if (pendingReward.typeKey === 'album') {
        var albumImg = 'Images/06_Merch/EP30_Album.jpeg';
        typeEl.innerHTML =
          '<img src="' + albumImg + '" alt="CALIX album" class="rw-photocard-img" onerror="this.src=\'https://picsum.photos/seed/calix-album/300/300\'">' +
          '<p class="rw-accessory-label">CALIX — first pressing</p>';
      } else if (pendingReward.typeKey === 'drink') {
        var DRINK_IMAGES = {
          17: 'Images/07_Drinks/EP17_Vitaminwater.png',
        };
        var drinkImg = DRINK_IMAGES[gameState.currentEpisodeN] || null;
        if (drinkImg) {
          var drinkLabel = mapParts.leftPlain || pendingReward.itemLabel || 'Drink';
          typeEl.innerHTML =
            '<img src="' + drinkImg + '" alt="' + escapeHtml(drinkLabel) + '" class="rw-photocard-img">' +
            '<p class="rw-accessory-label">' + escapeHtml(drinkLabel) + '</p>';
        } else {
          typeEl.innerHTML = '';
          typeEl.textContent = formatRewardPopupTypeLine(pendingReward.typeKey, pendingReward.coins, mapParts);
        }
      } else {
        typeEl.innerHTML = '';
        typeEl.textContent = formatRewardPopupTypeLine(
          pendingReward.typeKey,
          pendingReward.coins,
          mapParts
        );
      }
    }
    if (lineEl) lineEl.textContent = reactionLineFromEpisodeChoices();
    const coinEl = document.getElementById('rw-popup-coins');
    if (coinEl) {
      coinEl.textContent = pendingReward.coins ? '+' + pendingReward.coins + ' coins' : '';
    }
    const itemEl = document.getElementById('rw-popup-item');
    if (itemEl) itemEl.textContent = mapParts.narrative || '';
    ov.classList.add('show');
  }

  function hideRewardPopup() {
    const ov = document.getElementById('reward-popup');
    if (ov) ov.classList.remove('show');
  }

  function buildFlowFromMarkdown(md) {
    window.__calixLastEpisodeMd = md;
    const segments = splitMarkdownSegments(md);
    const queue = [];
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      if (seg.type === 'story') {
        storySegmentToBeats(seg.raw).forEach(function (b) {
          queue.push(b);
        });
      } else {
        const c = parseChoiceBlock(seg.raw);
        if (c.preamble && c.preamble.trim()) {
          storySegmentToBeats(c.preamble).forEach(function (b) {
            queue.push(b);
          });
        }
        if (c.options.length) {
          queue.push({
            type: 'choice',
            title: c.title,
            options: c.options,
          });
        }
      }
    }
    return stripMarkdownBoldFromFlowQueue(queue);
  }

  function startEpisode(n) {
    clearSceneStream();

    // Paywall: ep 4+ requires premium unlock
    if (n >= PAYWALL_EPISODE && !isPremiumUnlocked()) {
      renderPaywall();
      return;
    }

    // Google Analytics: episode start tracking
    if (typeof gtag === 'function') {
      gtag('event', 'episode_start', {
        episode_number: n,
        episode_label: 'ep' + String(n).padStart(2, '0')
      });
    }

    const entry = episodesIndex.find(function (e) {
      return e.n === n;
    });
    if (!entry) {
      appendStreamBlock('<div class="narration">Episode not found.</div>', '');
      return;
    }

    const gate = episodesMapMeta[n] && episodesMapMeta[n].gate;
    const chk = checkGate(gate || 'None');
    if (!chk.ok) {
      renderEpisodeLocked(chk.reason);
      return;
    }

    fetchText(SCRIPTS + entry.file)
      .then(function (text) {
        continueStartEpisode(n, text, entry);
      })
      .catch(function () {
        appendStreamBlock(
          '<div class="narration">Could not load script. Serve the folder over HTTP (e.g. python serve.py) so Context/ files can be fetched.</div>',
          ''
        );
      });
  }

  function continueStartEpisode(n, md, entry) {
    md = filterEpisodeScriptForPlayer(md);
    const titleLine = md.match(/^#\s*CALIX Episode \d+ — "([^"]+)"/m);
    currentEpisodeTitle = titleLine ? titleLine[1] : 'Episode ' + n;
    const epLabel = document.getElementById('ep-label-num');
    if (epLabel) {
      epLabel.textContent =
        'Episode ' + String(n).padStart(2, '0') + ' — ' + currentEpisodeTitle;
    }
    const prog = document.getElementById('ep-progress');
    if (prog) {
      const total = episodesIndex.length || 30;
      prog.textContent = 'Episode ' + n + ' / ' + total;
    }

    const setting = md.match(/\*\*Setting:\*\*\s*(.+)/);
    const eyebrow = document.getElementById('scene-eyebrow');
    if (eyebrow) {
      eyebrow.textContent = setting ? setting[1].trim().replace(/\*\*/g, '') : '';
    }

    flowQueue = buildFlowFromMarkdown(md);
    flowIdx = 0;
    choiceBlockIdx = 0;
    lastNarrationFp = '';
    lastDialogueDedup = '';
    episodeChoiceStatDelta = {};
    const streamEl = document.getElementById('scene-stream');
    if (streamEl) streamEl.scrollTop = 0;

    const BANNER_EPISODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
    const BANNER_IMAGES = {
      1: 'Images/04_Banner/EP01_Banner.png',
      2: 'Images/04_Banner/EP02_Banner.png',
      3: 'Images/04_Banner/EP03_Banner.png',
      4: 'Images/04_Banner/EP04_Banner.jpeg',
      5: 'Images/04_Banner/EP05_Banner.png',
      8: 'Images/04_Banner/EP08_Banner.jpeg',
      9: 'Images/04_Banner/EP09_Banner.png',
      11: 'Images/04_Banner/EP11_Banner.png',
      12: 'Images/04_Banner/EP12_Banner.png',
      14: 'Images/04_Banner/EP14_Banner.png',
      15: 'Images/04_Banner/EP15_Banner.png',
      16: 'Images/04_Banner/EP16_Banner.png',
      18: 'Images/04_Banner/EP18_Banner.png',
      19: 'Images/04_Banner/EP19_Banner.jpeg',
      21: 'Images/04_Banner/EP21_Banner.png',
      22: 'Images/04_Banner/EP22_Banner.png',
      23: 'Images/04_Banner/EP23_Banner.png',
      25: 'Images/04_Banner/EP25_Banner.png',
      26: 'Images/04_Banner/EP26_Banner.png',
      28: 'Images/04_Banner/EP28_Banner.png',
      29: 'Images/04_Banner/EP29_Banner.png',
      6: 'Images/04_Banner/EP06_Banner.png',
      7: 'Images/04_Banner/EP07_Banner.jpeg',
      10: 'Images/04_Banner/EP10_Banner.jpeg',
      13: 'Images/04_Banner/EP13_Banner.jpeg',
      17: 'Images/04_Banner/EP17_Banner.jpeg',
      20: 'Images/04_Banner/EP20_Banner.png',
      24: 'Images/04_Banner/EP24_Banner.jpeg',
      27: 'Images/04_Banner/EP27_Banner.png',
      30: 'Images/04_Banner/EP30_Banner.jpeg',
    };
    if (streamEl && BANNER_EPISODES.indexOf(n) !== -1) {
      var bannerWrap = document.createElement('div');
      bannerWrap.className = 'ep-banner';
      var bannerImg = document.createElement('img');
      bannerImg.src = BANNER_IMAGES[n] || 'https://picsum.photos/seed/calix-ep' + n + '/800/450';
      bannerImg.alt = '';
      bannerImg.className = 'ep-banner-img';
      bannerWrap.appendChild(bannerImg);
      streamEl.insertBefore(bannerWrap, streamEl.firstChild);
    }
    flushContinuousSegment();
  }

  window.initEpisode = function () {
    giftShownThisEpisode = false;
    loadSave();
    // URL ?ep=N 딥링크면 localStorage 저장값보다 우선 적용
    var _epParam = new URLSearchParams(window.location.search).get('ep');
    if (_epParam) {
      var _epN = parseInt(_epParam, 10);
      if (!isNaN(_epN) && _epN >= 1 && _epN <= 30) {
        gameState.currentEpisodeN = _epN;
        gameState.unlockedThrough = Math.max(gameState.unlockedThrough || 0, _epN);
        if (!gameState.candidateName) {
          gameState.candidateName = 'ALEX';
          gameState.candidateArchetype = 'STRONG';
          gameState.candidateBlurb = '';
        }
      }
    }
    syncNavIdentity();
    renderStatsSidebar();
    if (!gameState.candidateName) {
      const stream = document.getElementById('scene-stream');
      if (stream) {
        stream.innerHTML =
          '<div class="narration">Select the fifth member on the previous screen, then confirm.</div>';
      }
      return;
    }
    startEpisode(gameState.currentEpisodeN);
  };

  const CANDIDATE_ARCHETYPE = { ALEX: 'STRONG', YOOJIN: 'STRONG', GREY: 'SOFT' };
  /** Grid layout: pos 0 = top center, pos 1 = bottom left, pos 2 = bottom right. */
  const CANDIDATE_FAN_ORDER = ['YOOJIN', 'ALEX', 'GREY'];
  const CANDIDATE_FULL_NAMES = { YOOJIN: 'YooJin Min', ALEX: 'Alex Lee', GREY: 'Grey Woo' };

  window.confirmChoose = function () {
    if (!selectedCardEl) return;
    const name = selectedCardEl.dataset.name;
    if (!name) return;
    gameState.candidateName = name;
    gameState.candidateArchetype = CANDIDATE_ARCHETYPE[name] || null;
    gameState.candidateBlurb = selectedCardEl.dataset.body || '';
    saveGame();
    syncNavIdentity();
    document.getElementById('ov-name').textContent = name;
    var ovBodyEl = document.getElementById('ov-body');
    if (ovBodyEl) {
      var prof = candidateBackstories[name] || {};
      var bodyHtml = '';
      // Narrative paragraphs (who he is + backstory)
      if (prof.previous) {
        prof.previous.split(/\n\n+/).forEach(function (para) {
          var p = para.replace(/\s+/g, ' ').trim();
          if (p) bodyHtml += '<p>' + escapeHtml(p) + '</p>';
        });
      }
      // Stat lines
      var stats = [
        { key: 'Left behind', val: prof.gave },
        { key: 'What he brought', val: prof.brought },
        { key: 'The part he doesn\'t say', val: prof.shadow },
      ].filter(function (s) { return s.val && s.val !== '—'; });
      if (stats.length) {
        bodyHtml += '<div class="ov-stat-block">';
        stats.forEach(function (s) {
          bodyHtml += '<div class="ov-stat-line"><span class="ov-stat-key">' + escapeHtml(s.key) + '</span><span class="ov-stat-val">' + escapeHtml(s.val) + '</span></div>';
        });
        bodyHtml += '</div>';
      }
      ovBodyEl.innerHTML = bodyHtml || escapeHtml(gameState.candidateBlurb || '—');
    }
    var ovImg = document.querySelector('#overlay .ov-img img');
    var cardImg = selectedCardEl.querySelector('img');
    if (ovImg && cardImg && cardImg.src) ovImg.src = cardImg.src;
    document.getElementById('overlay').classList.add('show');
  };

  function initRewardCalix() {
    const focus = gameState.candidateName || '—';
    const rwFocus = document.getElementById('rw-focus');
    if (rwFocus) rwFocus.textContent = '5th: ' + focus;

    const btn = document.getElementById('rw-btn-next');
    const maxN = Math.max.apply(
      null,
      episodesIndex.map(function (e) {
        return e.n;
      })
    );
    const nextN = gameState.currentEpisodeN + 1;
    if (nextN > maxN) {
      if (btn) {
        btn.textContent = 'Fin · back to title';
        btn.disabled = false;
      }
    } else {
      const chk = checkGate((episodesMapMeta[nextN] && episodesMapMeta[nextN].gate) || 'None');
      if (btn) {
        btn.textContent = chk.ok ? 'Next episode →' : 'Next episode (locked)';
        btn.disabled = !chk.ok;
      }
    }

    const tok = document.getElementById('rw-tokens');
    if (tok) tok.textContent = String(gameState.stats.COINS);
    renderStatsSidebar();

    // Gift nudge replaced by full gift overlay (openGiftScreen via proceedFromRewardPopupToRewardScreen)
    var nudgeEl = document.getElementById('reward-gift-nudge');
    if (nudgeEl) nudgeEl.style.display = 'none';
  }

  window.initReward = initRewardCalix;

  window.claimNextEpisode = function () {
    giftShownThisEpisode = false;
    const maxN = Math.max.apply(
      null,
      episodesIndex.map(function (e) {
        return e.n;
      })
    );
    const nextN = gameState.currentEpisodeN + 1;
    if (nextN > maxN) {
      window.location.href = 'calix-ending.html';
      return;
    }
    const chk = checkGate((episodesMapMeta[nextN] && episodesMapMeta[nextN].gate) || 'None');
    if (!chk.ok) {
      try {
        const gateRaw = (episodesMapMeta[nextN] && episodesMapMeta[nextN].gate) || 'None';
        console.log('[CALIX] Next episode locked', {
          currentEpisodeN: gameState.currentEpisodeN,
          nextN: nextN,
          gate: gateRaw,
          reason: chk.reason,
          stats: Object.assign({}, gameState.stats),
          unlockedThrough: gameState.unlockedThrough,
        });
      } catch (e) { /* ignore */ }
      return;
    }
    gameState.currentEpisodeN = nextN;
    saveGame();
    if (typeof go === 'function') go(5);
  };

  window.beginStoryFromOverlay = function () {
    document.getElementById('overlay').classList.remove('show');
    gameState.stats = {
      KAIN_TRUST: 0,
      THEO_TRUST: 0,
      JAY_TRUST: 0,
      FINN_TRUST: 0,
      GROUP_REP: 0,
      SKILL: 0,
      COINS: 0,
    };
    gameState.inventory = [];
    gameState.episodeChoices = {};
    gameState.unlockedThrough = 1;
    gameState.currentEpisodeN = 1;
    gameState.lastGiftMember = null;
    gameState.lastGiftEpisode = null;
    saveGame();
    setTimeout(function () {
      if (typeof go === 'function') go(5);
    }, 380);
  };

  const GIFT_COST_SMALL = 50;
  const GIFT_COST_MEANINGFUL = 150;
  const GIFT_MEANINGFUL_KEYS = ['headphones','perfume','scarf'];
  const SPECIAL_EP_UNLOCKS = { 10: 500, 20: 800 };  // ep → coins needed
  const GIFT_THANK_YOU = {
    KAIN: {
      coffee:   ["Thanks. I needed this.", "...You didn't have to do that.", "Good timing. I was running low."],
      candy:    ["I'll eat it after practice. Thanks.", "Leaving some for you.", "You keep doing this."],
      energy:   ["Good. I needed one of these.", "You knew I was dragging today.", "This'll keep me going. Thank you."],
      vitamin:  ["I keep forgetting to take these. Thanks.", "You actually pay attention. I noticed.", "...This was thoughtful."],
      headphones: ["I've been using the same pair for three years.", "...These are good. You have a better eye than I gave you credit for.", "I don't usually let people pick things for me. This is an exception."],
      perfume:    ["...Where did you find this.", "I don't wear things like this often. But I will.", "You picked this. That means something."],
      scarf:      ["It's the right weight.", "I'll actually use this. I don't say that to be polite.", "...You thought about me outside of practice. I didn't expect that."],
    },
    THEO: {
      coffee:   ["Wait — this is for me? Genuinely, thank you.", "I was dying for this. How did you know.", "You didn't have to. But I'm really glad you did."],
      candy:    ["You and snacks. Best combination.", "These are my favorites. You actually noticed that.", "I hadn't said anything but I was starving. Thank you."],
      energy:   ["I was literally about to crash. How did you know!!", "You're a lifesaver. Genuinely.", "I could cry. I needed this so badly."],
      vitamin:  ["You're taking care of me 🥺 I love that.", "Nobody thinks about this stuff. You do.", "You actually noticed I forget these every day!!"],
      headphones: ["WAIT ARE THESE FOR ME", "I've been wanting these for so long you have no idea!!", "I'm wearing these right now. Thank you thank you thank you."],
      perfume:    ["This smells incredible. How did you even choose this.", "I'm going to think of you every time I wear it 🥺", "You actually picked this for me specifically. I can tell."],
      scarf:      ["It's so soft!!! I'm wearing it immediately.", "You thought about keeping me warm. I can't handle that.", "This is the color I would've picked myself. How did you know."],
    },
    JAY: {
      coffee:   ["Oh — thanks. You didn't have to.", "I'll drink it. Really, thank you.", "Didn't expect this. That was thoughtful."],
      candy:    ["We should eat together sometime. I'm serious.", "I hadn't eaten yet. How did you know that.", "Thanks. And I mean that, not just saying it."],
      energy:   ["...I needed this. Thank you.", "You noticed I was fading. That's observant.", "I'll owe you one. I mean that."],
      vitamin:  ["You thought about my health. That's — yeah. Thank you.", "I keep meaning to take these.", "...That was thoughtful. More than you know."],
      headphones: ["...I needed a new pair. You didn't know that.", "Good sound. You chose well.", "I'll use these when I need to be somewhere else for a while. Thank you."],
      perfume:    ["This is understated. I appreciate that.", "...I'll remember you picked this.", "You have a quiet kind of taste. This suits it."],
      scarf:      ["Practical. Good weight.", "...I'll wear it. I mean that.", "You thought about something small and got it right. That's not nothing."],
    },
    FINN: {
      coffee:   ["This is so thoughtful. Thank you, seriously.", "You got this for me? That actually means a lot.", "I needed this more than you know. Thank you."],
      candy:    ["How did you know I liked these? This is really kind.", "You thought of me. I don't take that lightly.", "I'd been thinking about these all day. Did you just know?"],
      energy:   ["You saw I was tired even when I didn't say anything.", "Thank you. Really.", "I'll remember you gave me this."],
      vitamin:  ["You noticed. That's the part that gets me.", "I'll take it right now. Watch.", "...You take care of people quietly. I see that."],
      headphones: ["I'll use these when I'm shooting. The ones I had were starting to go.", "...You noticed something I never said out loud.", "Good choice. I mean that specifically."],
      perfume:    ["I'm careful about scent. This one is right.", "...I'll keep this. It'll last a while.", "You chose something quiet. I noticed that about you too."],
      scarf:      ["I'll wear this on the early calls. It gets cold before the sun's up.", "...Thank you. Genuinely.", "You thought about what I might actually need. That's the part that gets me."],
    },
  };
  const GIFT_MEMBER_LABEL = { KAIN: 'Kain', THEO: 'Theo', JAY: 'Jay', FINN: 'Finn' };

  let giftPickMember = null;
  let giftPickType = null;
  let giftUiInitialized = false;
  let lastTxtMember = null;  // member chosen in the most recent text moment

  function proceedFromRewardPopupToRewardScreen() {
    var TEXT_MOMENT_EPS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30];
    var ep = gameState.currentEpisodeN;
    var txtKey = 'calix_txt_ep' + ep;
    if (TEXT_MOMENT_EPS.indexOf(ep) !== -1 && !localStorage.getItem(txtKey) && TEXT_MOMENTS[ep]) {
      localStorage.setItem(txtKey, '1');
      showTextMoment(ep);
      return;
    }
    if (!giftShownThisEpisode && shouldOfferGiftScreen()) {
      giftShownThisEpisode = true;
      openGiftScreen();
    } else {
      finishEpisodeFlow();
    }
  }

  // ── TEXT MOMENT SYSTEM ──────────────────────────────────────────
  var MEMBER_COLORS = { KAIN:'#1a1a2e', THEO:'#6B4FD8', JAY:'#6b7f6b', FINN:'#8a7a6e' };
  var MEMBER_INITIALS = { KAIN:'K', THEO:'T', JAY:'J', FINN:'F' };

  var TEXT_MOMENTS = {
    2: {
      KAIN: { time:'11:44 PM',
        options:[
          { label:"your center hold was cleaner in the second run",
            convo:[
              {f:'me', t:"your center hold was cleaner in the second run"},
              {f:'them', t:"you noticed that", ms:1600},
              {f:'me', t:"was i not supposed to", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"most people don't watch that closely", ms:1400},
              {f:'me', t:"i wasn't watching everyone", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'read', time:'11:49 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"what did you mean. don't hold back",
            convo:[
              {f:'me', t:"what did you mean when you said don't hold back"},
              {f:'them', t:"exactly what it sounds like", ms:1200},
              {f:'me', t:"kain", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"you perform like you're waiting for permission", ms:1800},
              {f:'me', t:"from who", ms:600},
              {f:'them', t:"that's what i'm asking you", ms:1600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"stop waiting", ms:800},
              {f:'read', time:'11:51 PM'}
            ], fx:{KAIN_TRUST:1} }
        ]},
      THEO: { time:'11:38 PM',
        options:[
          { label:"you barely touched your food today",
            convo:[
              {f:'me', t:"you barely touched your food today"},
              {f:'them', t:"i ate!!", ms:900},
              {f:'me', t:"half a bowl", ms:600},
              {f:'them', t:"i was distracted okay", ms:1400},
              {f:'me', t:"by what", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you kept doing this thing with your hands when you're nervous", ms:1800},
              {f:'me', t:"what thing", ms:600},
              {f:'them', t:"i don't know how to describe it. i just kept looking", ms:1600},
              {f:'read', time:'11:43 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"first day survived",
            convo:[
              {f:'me', t:"first day survived"},
              {f:'them', t:"barely!!", ms:700},
              {f:'them', t:"i almost cried during the second run-through", ms:800},
              {f:'me', t:"i saw", ms:500},
              {f:'them', t:"you SAW??", ms:1000},
              {f:'me', t:"you were blinking a lot", ms:600},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"that's my tell", ms:1000},
              {f:'them', t:"nobody's ever noticed before", ms:500},
              {f:'read', time:'11:42 PM'}
            ], fx:{THEO_TRUST:1} }
        ]},
      JAY: { time:'11:55 PM',
        options:[
          { label:"the song you were humming after the third run-through",
            convo:[
              {f:'me', t:"the song you were humming. after the third run-through"},
              {f:'them', t:"didn't realize i was doing it", ms:2000},
              {f:'me', t:"you do it when you think no one's around", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"how long have you noticed", ms:1200},
              {f:'me', t:"since today", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"it's something i write when i don't know what else to do with it", ms:1800},
              {f:'me', t:"with what", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i'll tell you when i figure it out", ms:1000},
              {f:'read', time:'12:02 AM'}
            ], fx:{JAY_TRUST:1} },
          { label:"do you actually want to be here",
            convo:[
              {f:'me', t:"do you actually want to be here"},
              {f:'them', t:"yeah", ms:1800},
              {f:'me', t:"you could've said it with less thought", ms:600},
              {f:'them', t:"i don't say things i don't mean", ms:1400},
              {f:'me', t:"what made you think about it", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you", ms:800},
              {f:'me', t:"me", ms:400},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"get some sleep", ms:900},
              {f:'read', time:'12:04 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:47 PM',
        options:[
          { label:"what were you shooting during cooldown",
            convo:[
              {f:'me', t:"what were you shooting during cooldown"},
              {f:'them', t:"the room", ms:1400},
              {f:'me', t:"why then specifically", ms:600},
              {f:'them', t:"the light gets long when it empties. and people leave things", ms:1800},
              {f:'me', t:"what things", ms:600},
              {f:'them', t:"water bottles. towels. where someone was standing", ms:2000},
              {f:'me', t:"you can see where someone was standing", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i can see where you were", ms:1600},
              {f:'read', time:'11:54 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"you've been looking at me all day",
            convo:[
              {f:'me', t:"you've been looking at me all day"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"was i bothering you", ms:1200},
              {f:'me', t:"no", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'me', t:"i was just wondering what you were seeing", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"someone i wasn't expecting", ms:1400},
              {f:'read', time:'11:52 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    5: {
      KAIN: { time:'12:07 AM',
        options:[
          { label:"you were in the studio at 2am again",
            convo:[
              {f:'me', t:"you were in the studio at 2am again"},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you timed it", ms:1000},
              {f:'me', t:"i heard you through the wall", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"what did it sound like", ms:1400},
              {f:'me', t:"like you were working something out", ms:700},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"was it about today", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it was about you, actually", ms:1600},
              {f:'read', time:'12:11 AM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"you didn't eat again today",
            convo:[
              {f:'me', t:"you didn't eat again today"},
              {f:'them', t:"i'm fine", ms:1000},
              {f:'me', t:"that's not what i asked", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i get like this when something's not clicking", ms:1600},
              {f:'me', t:"what isn't clicking", ms:600},
              {f:'them', t:"the bridge. third section. i keep losing it", ms:1400},
              {f:'me', t:"show me tomorrow", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"okay", ms:1000},
              {f:'read', time:'12:09 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:52 PM',
        options:[
          { label:"that playlist from today. send it",
            convo:[
              {f:'me', t:"that playlist from today. send it"},
              {f:'them', t:"!!!! okay but you have to listen in order", ms:800},
              {f:'them', t:"[playlist: theo's 3am mix 🌙]", ms:400},
              {f:'them', t:"track 7 is the one. i was thinking of you when i put it in", ms:1400},
              {f:'me', t:"...", ms:700},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"listen first", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"then you'll know why", ms:600},
              {f:'read', time:'11:58 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you always step in when things get tense",
            convo:[
              {f:'me', t:"you always step in when things get tense"},
              {f:'them', t:"does it bother you", ms:1200},
              {f:'me', t:"no. i just wonder who steps in for you", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"can i tell you something weird", ms:1200},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"lately it's been easier. because of you", ms:1600},
              {f:'read', time:'11:57 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:18 AM',
        options:[
          { label:"you left something on the piano",
            convo:[
              {f:'me', t:"you left something on the piano"},
              {f:'them', t:"it wasn't for anyone to read", ms:1600},
              {f:'me', t:"i didn't read all of it", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"how much", ms:1200},
              {f:'me', t:"enough to know it was real", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"delete that from your memory", ms:1000},
              {f:'me', t:"i can't", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah. me neither.", ms:1400},
              {f:'read', time:'12:23 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"you never explain yourself to anyone",
            convo:[
              {f:'me', t:"you never explain yourself to anyone"},
              {f:'them', t:"no", ms:1400},
              {f:'me', t:"not even yourself?", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"especially not myself", ms:1200},
              {f:'me', t:"does that ever get lonely", ms:600},
              {f:'them', t:"yeah", ms:1000},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"it's less lately", ms:800},
              {f:'read', time:'12:22 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:49 PM',
        options:[
          { label:"show me one photo from today",
            convo:[
              {f:'me', t:"show me one"},
              {f:'them', t:"one what", ms:1200},
              {f:'me', t:"photo from today", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"[photo: the hallway outside the studio. 2:17am. one light on. someone's shadow on the wall]", ms:1000},
              {f:'me', t:"is that my shadow", ms:700},
              {f:'them', t:"you were there first", ms:1400},
              {f:'me', t:"you were waiting", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i was documenting", ms:1000},
              {f:'read', time:'11:55 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"you know more than you let on",
            convo:[
              {f:'me', t:"you know more than you let on"},
              {f:'them', t:"everyone does", ms:1400},
              {f:'me', t:"not like you", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"what do you think i know", ms:1200},
              {f:'me', t:"about all of us. what we're like when we think no one's watching", ms:800},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i know what you're like", ms:1400},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"and it's my favorite thing in here to photograph", ms:1600},
              {f:'read', time:'11:56 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    8: {
      KAIN: { time:'11:58 PM',
        options:[
          { label:"good show tonight",
            convo:[
              {f:'me', t:"good show tonight"},
              {f:'them', t:"your formation held through the third section", ms:1400},
              {f:'me', t:"is that all you noticed", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"no", ms:800},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"you stopped waiting for permission out there", ms:1800},
              {f:'them', t:"...", ms:1000},
              {f:'them', t:"looked good on you", ms:600},
              {f:'read', time:'12:03 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"the second chorus. you looked at me",
            convo:[
              {f:'me', t:"the second chorus. you looked at me"},
              {f:'them', t:"i look at everyone", ms:1400},
              {f:'me', t:"kain", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i count one beat before the drop", ms:1200},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i was using you", ms:1400},
              {f:'me', t:"for the count", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"don't read into it", ms:800},
              {f:'me', t:"already did", ms:400},
              {f:'read', time:'12:05 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:44 PM',
        options:[
          { label:"i saw you backstage after the show",
            convo:[
              {f:'me', t:"i saw you backstage after the show"},
              {f:'them', t:"i was not crying", ms:900},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"okay i was a little", ms:1200},
              {f:'me', t:"a lot", ms:400},
              {f:'them', t:"it just hit me. like all at once", ms:1600},
              {f:'me', t:"what did", ms:500},
              {f:'them', t:"that we actually did it", ms:1000},
              {f:'them', t:"and that you were there when it happened", ms:800},
              {f:'read', time:'11:49 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you were different tonight",
            convo:[
              {f:'me', t:"you were different tonight"},
              {f:'them', t:"good different or bad different", ms:900},
              {f:'me', t:"i was holding my breath watching you", ms:700},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i felt it. like actually felt it in my chest", ms:1200},
              {f:'me', t:"i could tell from the third row", ms:600},
              {f:'them', t:"you were watching me specifically", ms:1400},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"okay hi. hello. i'm normal about this.", ms:900},
              {f:'read', time:'11:52 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:11 AM',
        options:[
          { label:"you closed your eyes during the bridge",
            convo:[
              {f:'me', t:"you closed your eyes during the bridge"},
              {f:'them', t:"i do that when it stops being performance", ms:1800},
              {f:'me', t:"what was it instead", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i was thinking of someone", ms:1600},
              {f:'me', t:"who", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"goodnight", ms:800},
              {f:'read', time:'12:16 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"write something about tonight",
            convo:[
              {f:'me', t:"write something about tonight"},
              {f:'them', t:"i started it on the way home", ms:1400},
              {f:'me', t:"what's it called", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"don't have a title yet", ms:1200},
              {f:'me', t:"what's it about", ms:600},
              {f:'them', t:"the second chorus", ms:1600},
              {f:'me', t:"...", ms:700},
              {f:'me', t:"jay", ms:400},
              {f:'them', t:"get some sleep", ms:1200},
              {f:'read', time:'12:15 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:53 PM',
        options:[
          { label:"did you get it. the shot you were waiting for",
            convo:[
              {f:'me', t:"did you get it. the shot you were waiting for"},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"how did you know i was waiting for something", ms:1000},
              {f:'me', t:"the way you go still before you press it", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i got it", ms:1000},
              {f:'me', t:"what was it", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you. right before the drop. you looked like you finally arrived somewhere", ms:2000},
              {f:'read', time:'11:58 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"was i in any of the photos",
            convo:[
              {f:'me', t:"what did tonight look like through the lens"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"warm. a little too bright. real", ms:900},
              {f:'me', t:"was i in any of them", ms:600},
              {f:'them', t:"most of them", ms:1600},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you move differently when you forget people are watching", ms:1600},
              {f:'them', t:"i've been trying to catch that moment for a while", ms:500},
              {f:'read', time:'11:59 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    11: {
      KAIN: { time:'11:56 PM',
        options:[
          { label:"i think i pushed too hard today",
            convo:[
              {f:'me', t:"i think i pushed too hard today"},
              {f:'them', t:"you pushed back", ms:1200},
              {f:'me', t:"you didn't seem happy about it", ms:600},
              {f:'them', t:"i'm never happy in the moment", ms:1600},
              {f:'me', t:"but after", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you surprised me", ms:1400},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"that doesn't happen often", ms:1600},
              {f:'them', t:"...", ms:1200},
              {f:'them', t:"i wanted you to know", ms:800},
              {f:'read', time:'11:59 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"do you ever get tired of being the one who holds it together",
            convo:[
              {f:'me', t:"do you ever get tired of being the one who holds everything together"},
              {f:'them', t:"sometimes", ms:1800},
              {f:'me', t:"tonight?", ms:600},
              {f:'them', t:"tonight was different", ms:1600},
              {f:'me', t:"how", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you stayed beside me", ms:1400},
              {f:'them', t:"i don't usually notice that kind of thing", ms:800},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"i noticed", ms:800},
              {f:'read', time:'12:02 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:49 PM',
        options:[
          { label:"you were off today. what happened",
            convo:[
              {f:'me', t:"you were off today. what happened"},
              {f:'them', t:"i wasn't off", ms:900},
              {f:'me', t:"theo", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i had a call with my mom before practice", ms:1400},
              {f:'me', t:"is everything okay", ms:600},
              {f:'them', t:"yeah. she just. she said she's proud of me", ms:1800},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"i wasn't ready to hear that. it made the whole day feel heavy", ms:1600},
              {f:'me', t:"i get it", ms:500},
              {f:'them', t:"i know you do. that's why i answered when you texted", ms:1400},
              {f:'read', time:'11:55 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you don't have to perform for me",
            convo:[
              {f:'me', t:"you don't have to perform for me"},
              {f:'them', t:"what do you mean", ms:1200},
              {f:'me', t:"the thing you do when the energy drops. being on. i don't need it", ms:800},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"is it that obvious", ms:900},
              {f:'me', t:"only to me", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"nobody's ever said that before", ms:1200},
              {f:'me', t:"...", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"stop making me feel things at midnight", ms:1000},
              {f:'read', time:'11:54 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:08 AM',
        options:[
          { label:"what are you writing lately",
            convo:[
              {f:'me', t:"what are you writing lately"},
              {f:'them', t:"things", ms:1600},
              {f:'me', t:"what kind of things", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"about what changes when you stop being the only one who understands yourself", ms:2000},
              {f:'me', t:"what does that mean", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it means someone else gets it now", ms:1400},
              {f:'me', t:"who", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"ask me again when i figure out how to say it", ms:1200},
              {f:'read', time:'12:13 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"you've been quieter than usual",
            convo:[
              {f:'me', t:"you've been quieter than usual"},
              {f:'them', t:"i'm always quiet", ms:1400},
              {f:'me', t:"not like this", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i'm trying to write something and i can't find the first line", ms:1600},
              {f:'me', t:"what's it about", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"you. kind of. don't make it weird", ms:1400},
              {f:'me', t:"...", ms:700},
              {f:'me', t:"too late", ms:500},
              {f:'read', time:'12:15 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:58 PM',
        options:[
          { label:"you've been carrying that camera everywhere lately",
            convo:[
              {f:'me', t:"you've been carrying that camera everywhere lately"},
              {f:'them', t:"i always do", ms:1400},
              {f:'me', t:"more than before", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"there's more worth keeping", ms:1600},
              {f:'me', t:"like what", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you. mostly", ms:1200},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"it's a compliment", ms:1000},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"receive it", ms:600},
              {f:'read', time:'12:03 AM'}
            ], fx:{FINN_TRUST:2} },
          { label:"what do you see when you look at me",
            convo:[
              {f:'me', t:"what do you see when you look at me"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"someone who's still becoming", ms:1800},
              {f:'me', t:"is that good", ms:600},
              {f:'them', t:"it's rare", ms:1400},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i find myself looking a lot lately", ms:1400},
              {f:'read', time:'12:01 AM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    14: {
      KAIN: { time:'12:04 AM',
        options:[
          { label:"you read every letter. right there at the table",
            convo:[
              {f:'me', t:"you read every letter. right there at the table"},
              {f:'them', t:"i always do", ms:1400},
              {f:'me', t:"most people skim", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"they took the time to write it", ms:1400},
              {f:'me', t:"one made you stop", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"she said i looked like someone worth staying for", ms:1800},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"don't", ms:1200},
              {f:'me', t:"she wasn't wrong", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'read', time:'12:09 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"i didn't expect you to be like that with them",
            convo:[
              {f:'me', t:"i didn't expect you to be like that with them"},
              {f:'them', t:"like what", ms:1400},
              {f:'me', t:"warm. present. like you actually saw each one", ms:700},
              {f:'them', t:"i did", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'me', t:"kain", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i know how it feels to need someone to see you", ms:1800},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"i learned that recently", ms:600},
              {f:'read', time:'12:11 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:38 PM',
        options:[
          { label:"how are you still standing",
            convo:[
              {f:'me', t:"how are you still standing"},
              {f:'them', t:"adrenaline and the people around me", ms:900},
              {f:'me', t:"...", ms:500},
              {f:'them', t:"you specifically. a little", ms:1200},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"you kept looking at me during the table and it helped", ms:1600},
              {f:'me', t:"i didn't realize you noticed", ms:600},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i always notice when it's you", ms:1200},
              {f:'read', time:'11:44 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you cried at the table",
            convo:[
              {f:'me', t:"you cried at the table"},
              {f:'them', t:"the fan was crying first!!", ms:800},
              {f:'me', t:"you were emotional before she sat down", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"she had this look when she first saw us", ms:1400},
              {f:'them', t:"like we were something real", ms:600},
              {f:'me', t:"you are", ms:400},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"sometimes i need someone else to remember that", ms:1200},
              {f:'me', t:"i'll remember", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"okay i'm going to cry again", ms:800},
              {f:'read', time:'11:42 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:14 AM',
        options:[
          { label:"did anyone write to you about your music",
            convo:[
              {f:'me', t:"did anyone write to you about your music"},
              {f:'them', t:"a few", ms:1600},
              {f:'me', t:"what did they say", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"that it sounded like something they thought only they felt", ms:2000},
              {f:'me', t:"that's what it does", ms:600},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you said that like you know", ms:1200},
              {f:'me', t:"i do", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"which song", ms:1000},
              {f:'read', time:'12:19 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"you stayed present the whole time",
            convo:[
              {f:'me', t:"you were uncomfortable today"},
              {f:'them', t:"crowds", ms:1200},
              {f:'me', t:"but you didn't leave. not once", ms:700},
              {f:'them', t:"they came for us", ms:1400},
              {f:'me', t:"i watched you the whole time", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"why", ms:1000},
              {f:'me', t:"i wanted to see what it looked like when you chose to stay", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"and", ms:800},
              {f:'me', t:"it looked like you", ms:500},
              {f:'read', time:'12:21 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:47 PM',
        options:[
          { label:"how many did you take today",
            convo:[
              {f:'me', t:"how many did you take today"},
              {f:'them', t:"a lot", ms:1400},
              {f:'me', t:"of what", ms:500},
              {f:'them', t:"the fans. the way they look when they first see you all", ms:2000},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"you", ms:800},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"you have a specific face when someone tells you you've helped them", ms:1800},
              {f:'me', t:"what face", ms:600},
              {f:'them', t:"like you don't know what to do with being cared for", ms:1600},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"i'm going to keep that one", ms:600},
              {f:'read', time:'11:53 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"today felt like proof",
            convo:[
              {f:'me', t:"today felt like proof"},
              {f:'them', t:"of what", ms:1400},
              {f:'me', t:"that this is worth it", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i got one shot today i'll print", ms:1200},
              {f:'me', t:"what is it", ms:600},
              {f:'them', t:"all five of us. the exact second we stopped being strangers", ms:2000},
              {f:'me', t:"when was that", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you were there. you'll recognize it", ms:1400},
              {f:'read', time:'11:52 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    17: {
      KAIN: { time:'11:48 PM',
        options:[
          { label:"you pushed us hard today",
            convo:[
              {f:'me', t:"you pushed us hard today"},
              {f:'them', t:"second half needs to hit harder", ms:1200},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"do you", ms:1800},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i pushed harder because i knew you could take it", ms:1400},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"that's different from pushing everyone", ms:1600},
              {f:'them', t:"...", ms:1200},
              {f:'them', t:"you know that right", ms:800},
              {f:'read', time:'11:54 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"what are you looking for when you watch me",
            convo:[
              {f:'me', t:"what are you looking for when you watch me"},
              {f:'them', t:"gaps", ms:1400},
              {f:'me', t:"you find fewer now", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"yeah", ms:1000},
              {f:'me', t:"is that good", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"there's something else i look for now", ms:1600},
              {f:'me', t:"what", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"if you're still enjoying it", ms:1400},
              {f:'read', time:'11:56 PM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'12:22 AM',
        options:[
          { label:"i'm exhausted and can't sleep",
            convo:[
              {f:'me', t:"i'm exhausted and can't sleep"},
              {f:'them', t:"same", ms:600},
              {f:'them', t:"the run-through kept replaying in my head", ms:1200},
              {f:'me', t:"the part where you fell", ms:600},
              {f:'them', t:"i did not FALL i recovered immediately", ms:900},
              {f:'me', t:"into the wall", ms:500},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"did you laugh", ms:900},
              {f:'me', t:"a little", ms:500},
              {f:'them', t:"good", ms:800},
              {f:'them', t:"you have a really good laugh", ms:400},
              {f:'read', time:'12:27 AM'}
            ], fx:{THEO_TRUST:2} },
          { label:"thank you for keeping the energy up today",
            convo:[
              {f:'me', t:"thank you for keeping the energy up today"},
              {f:'them', t:"that's just my personality", ms:800},
              {f:'me', t:"it's more than that", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i had a moment in the break where everything felt too much", ms:1600},
              {f:'me', t:"i saw", ms:500},
              {f:'them', t:"you saw??", ms:900},
              {f:'me', t:"you went to the corner and did the breathing thing", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"nobody's noticed that before", ms:1200},
              {f:'me', t:"i notice everything you do", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"that's. a lot.", ms:900},
              {f:'read', time:'12:26 AM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:28 AM',
        options:[
          { label:"you stayed after everyone left",
            convo:[
              {f:'me', t:"you stayed after everyone left"},
              {f:'them', t:"yeah", ms:1600},
              {f:'me', t:"what were you doing", ms:500},
              {f:'them', t:"feeling the room without anyone in it", ms:2000},
              {f:'me', t:"what does it feel like", ms:600},
              {f:'them', t:"honest", ms:1400},
              {f:'me', t:"and with people in it", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"louder. but better. since you got here", ms:1600},
              {f:'read', time:'12:34 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"the song you played at the end of rehearsal",
            convo:[
              {f:'me', t:"the song you played at the end"},
              {f:'them', t:"i didn't think anyone was still there", ms:1800},
              {f:'me', t:"i was", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"what did it sound like", ms:1000},
              {f:'me', t:"like something you'd been waiting to say out loud", ms:700},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"it has your name in the bridge", ms:1400},
              {f:'read', time:'12:36 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:57 PM',
        options:[
          { label:"you were behind the lens all day",
            convo:[
              {f:'me', t:"you were behind the lens all day"},
              {f:'them', t:"good place to be", ms:1400},
              {f:'me', t:"what do you see that we don't", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"how you all look at each other when you think no one's watching", ms:1800},
              {f:'me', t:"like how", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"the way you looked at me today", ms:1400},
              {f:'them', t:"specifically", ms:400},
              {f:'read', time:'12:03 AM'}
            ], fx:{FINN_TRUST:2} },
          { label:"finn",
            convo:[
              {f:'me', t:"finn"},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"nothing. just wanted to say your name", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i've been wanting to hear you say it all day", ms:1200},
              {f:'read', time:'12:01 AM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    20: {
      KAIN: { time:'1:14 AM',
        options:[
          { label:"are you okay",
            convo:[
              {f:'me', t:"are you okay"},
              {f:'them', t:"i'm fine", ms:1000},
              {f:'me', t:"kain", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"no", ms:800},
              {f:'me', t:"okay", ms:500},
              {f:'them', t:"that's all you're going to say", ms:1600},
              {f:'me', t:"you don't need fixing. you need someone to know", ms:800},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"yeah", ms:600},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"come here", ms:1000},
              {f:'read', time:'1:19 AM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"we'll get through this",
            convo:[
              {f:'me', t:"we'll get through this"},
              {f:'them', t:"you don't know that", ms:1400},
              {f:'me', t:"no", ms:500},
              {f:'me', t:"but i'm not going anywhere", ms:400},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"why", ms:900},
              {f:'me', t:"you know why", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"say it", ms:1200},
              {f:'read', time:'1:21 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'1:02 AM',
        options:[
          { label:"talk to me",
            convo:[
              {f:'me', t:"talk to me"},
              {f:'them', t:"i don't know how to say it", ms:2000},
              {f:'me', t:"you don't have to say it right", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"the wristband i gave you today", ms:1600},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"i've worn it for two years. i wanted you to have it", ms:1800},
              {f:'me', t:"theo", ms:500},
              {f:'them', t:"i'm scared of losing what we have", ms:1600},
              {f:'me', t:"you're not going to", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"if you're wearing it. i feel better", ms:1200},
              {f:'read', time:'1:08 AM'}
            ], fx:{THEO_TRUST:3} },
          { label:"you've been holding everyone together again",
            convo:[
              {f:'me', t:"you've been holding everyone together again"},
              {f:'them', t:"someone has to", ms:1200},
              {f:'me', t:"it doesn't have to be you every time", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"if i stop i think everything falls apart", ms:1800},
              {f:'me', t:"it won't", ms:500},
              {f:'them', t:"how do you know", ms:1200},
              {f:'me', t:"because i'm holding the part that's you", ms:700},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i don't know what to do with that", ms:1200},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"stay on the phone with me", ms:900},
              {f:'read', time:'1:11 AM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:58 AM',
        options:[
          { label:"are you writing",
            convo:[
              {f:'me', t:"are you writing"},
              {f:'them', t:"trying", ms:1400},
              {f:'me', t:"it's not coming", ms:600},
              {f:'them', t:"no", ms:1200},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"the song i was writing. the one with your name in the bridge", ms:2000},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"i can't find the ending", ms:1200},
              {f:'me', t:"what happens at the end", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i don't know yet. i think it depends on you", ms:1600},
              {f:'read', time:'1:04 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"i keep thinking about what you said",
            convo:[
              {f:'me', t:"i keep thinking about what you said"},
              {f:'them', t:"which part", ms:1400},
              {f:'me', t:"that it's less lonely", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"still true", ms:1000},
              {f:'me', t:"even tonight", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"especially tonight", ms:1000},
              {f:'me', t:"...", ms:500},
              {f:'them', t:"don't tell anyone", ms:1600},
              {f:'read', time:'1:06 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'1:08 AM',
        options:[
          { label:"it's loud in my head tonight",
            convo:[
              {f:'me', t:"it's loud in my head tonight"},
              {f:'them', t:"i know", ms:1200},
              {f:'me', t:"how", ms:500},
              {f:'them', t:"you're wearing the wristband", ms:1600},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"you only wear it when you're not okay", ms:1400},
              {f:'me', t:"how do you know that", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i've been watching you long enough", ms:1400},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"come sit with me", ms:1200},
              {f:'read', time:'1:12 AM'}
            ], fx:{FINN_TRUST:3} },
          { label:"do you ever feel like things are about to break",
            convo:[
              {f:'me', t:"do you ever feel like things are about to break"},
              {f:'them', t:"yeah", ms:1400},
              {f:'me', t:"does it scare you", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"what specifically", ms:1000},
              {f:'me', t:"that we don't come back from it the same way", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"we won't", ms:1200},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"we'll come back closer", ms:1600},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"at least i will. to you", ms:1000},
              {f:'read', time:'1:13 AM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    23: {
      KAIN: { time:'12:41 AM',
        options:[
          { label:"i didn't mean to come at you like that today",
            convo:[
              {f:'me', t:"i didn't mean to come at you like that today"},
              {f:'them', t:"you should've", ms:1400},
              {f:'me', t:"kain", ms:500},
              {f:'them', t:"you held back. i could feel it", ms:1600},
              {f:'me', t:"i didn't want to fight", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"you can fight with me", ms:1200},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i want you to. it means something to me when you do", ms:1600},
              {f:'read', time:'12:46 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"you scared me today",
            convo:[
              {f:'me', t:"you scared me today"},
              {f:'them', t:"i know", ms:1200},
              {f:'me', t:"do you", ms:500},
              {f:'them', t:"i saw your face", ms:1400},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"i'm sorry", ms:2200},
              {f:'me', t:"don't be", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"don't be?", ms:1000},
              {f:'me', t:"it means you let me see it", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"don't make it easier to let you in", ms:1400},
              {f:'read', time:'12:48 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'12:33 AM',
        options:[
          { label:"that was the hardest day we've had",
            convo:[
              {f:'me', t:"that was the hardest day we've had"},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"you okay", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i kept looking at you during it", ms:1400},
              {f:'me', t:"i saw", ms:500},
              {f:'them', t:"every time i thought it was going to fall apart i looked at you and i thought. okay. we're still here.", ms:2400},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"don't tell the others", ms:1200},
              {f:'me', t:"they probably did the same thing", ms:600},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"yeah. probably.", ms:800},
              {f:'read', time:'12:38 AM'}
            ], fx:{THEO_TRUST:3} },
          { label:"i keep replaying it",
            convo:[
              {f:'me', t:"i keep replaying it"},
              {f:'them', t:"me too", ms:1000},
              {f:'me', t:"what do you keep coming back to", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you", ms:800},
              {f:'me', t:"what about me", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"the way you stood there", ms:1200},
              {f:'them', t:"like you were deciding to stay in real time and you chose to stay", ms:1000},
              {f:'me', t:"i wasn't going anywhere", ms:600},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i know that now", ms:1000},
              {f:'read', time:'12:40 AM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:51 AM',
        options:[
          { label:"i don't know how to feel about today",
            convo:[
              {f:'me', t:"i don't know how to feel about today"},
              {f:'them', t:"you don't have to yet", ms:1800},
              {f:'me', t:"when does it settle", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"for me? when i write it down", ms:1400},
              {f:'me', t:"what would you write about today", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"five people who were breaking and chose each other anyway", ms:2000},
              {f:'me', t:"that's the whole thing isn't it", ms:700},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"the ending isn't written yet", ms:1200},
              {f:'them', t:"but i think i know how it goes", ms:600},
              {f:'read', time:'12:57 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"will you write about today",
            convo:[
              {f:'me', t:"will you write about today"},
              {f:'them', t:"yeah", ms:1400},
              {f:'me', t:"what angle", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"there's this moment. when everything was the most broken", ms:1800},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"you put your hand on the table. flat. like you were saying: i'm here", ms:2000},
              {f:'me', t:"i didn't think anyone noticed", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i always notice", ms:1200},
              {f:'them', t:"that's what the whole thing is about", ms:500},
              {f:'read', time:'12:59 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'12:44 AM',
        options:[
          { label:"you were quiet the whole time",
            convo:[
              {f:'me', t:"you were quiet during the whole thing"},
              {f:'them', t:"i was watching", ms:1400},
              {f:'me', t:"what did you see", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"all five of us at our worst", ms:1600},
              {f:'me', t:"that's a lot to take in", ms:600},
              {f:'them', t:"yeah", ms:1000},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"and you were still the steadiest thing in the room", ms:1600},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"i'm not being nice. i'm being accurate", ms:1200},
              {f:'read', time:'12:49 AM'}
            ], fx:{FINN_TRUST:2} },
          { label:"did you take any photos today",
            convo:[
              {f:'me', t:"did you take any photos today"},
              {f:'them', t:"no", ms:1400},
              {f:'me', t:"why not", ms:500},
              {f:'them', t:"some things aren't for keeping", ms:1800},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"today was yours", ms:1600},
              {f:'me', t:"ours", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah", ms:800},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"i took one. at the end. when you weren't looking", ms:1400},
              {f:'read', time:'12:50 AM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    26: {
      KAIN: { time:'11:38 PM',
        options:[
          { label:"things feel different",
            convo:[
              {f:'me', t:"things feel different"},
              {f:'them', t:"yeah", ms:1600},
              {f:'me', t:"good different?", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i keep waiting for it to stop feeling like this", ms:1400},
              {f:'me', t:"like what", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"easy", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"with you specifically", ms:1000},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"don't say anything", ms:800},
              {f:'read', time:'11:43 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"i feel like i can breathe again",
            convo:[
              {f:'me', t:"i feel like i can breathe again"},
              {f:'them', t:"same", ms:1400},
              {f:'me', t:"that's the most you've said in one word in a long time", ms:700},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"i've been saving it", ms:1200},
              {f:'me', t:"saving what", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"everything i didn't say when it was hard", ms:1600},
              {f:'me', t:"say it now", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i'm glad you stayed", ms:1400},
              {f:'read', time:'11:44 PM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:29 PM',
        options:[
          { label:"practice felt good today",
            convo:[
              {f:'me', t:"practice felt good today"},
              {f:'them', t:"RIGHT??", ms:700},
              {f:'them', t:"we were LAUGHING", ms:800},
              {f:'me', t:"i know. it's been a while", ms:600},
              {f:'them', t:"too long", ms:1000},
              {f:'them', t:"you did that thing today where you get really into it and forget to be nervous", ms:1600},
              {f:'me', t:"what thing", ms:600},
              {f:'them', t:"your whole face changes", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"it's my favorite version of you", ms:1000},
              {f:'read', time:'11:34 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you smiled the whole way home",
            convo:[
              {f:'me', t:"you smiled the whole way home"},
              {f:'them', t:"did i", ms:900},
              {f:'me', t:"the whole way", ms:500},
              {f:'them', t:"...", ms:1400},
              {f:'them', t:"things finally feel like they're mine", ms:1600},
              {f:'me', t:"like what", ms:600},
              {f:'them', t:"the group. the music. you", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"too much?", ms:900},
              {f:'me', t:"no", ms:400},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"good", ms:800},
              {f:'read', time:'11:33 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'11:52 PM',
        options:[
          { label:"i've been reading what you gave me",
            convo:[
              {f:'me', t:"i've been reading what you gave me"},
              {f:'them', t:"and?", ms:1600},
              {f:'me', t:"i think i understand you better now", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"which part", ms:1000},
              {f:'me', t:"the bridge", ms:500},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i wasn't sure you'd understand it", ms:1400},
              {f:'me', t:"i understood it", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you're the only person i'd want to", ms:1400},
              {f:'read', time:'11:57 PM'}
            ], fx:{JAY_TRUST:3} },
          { label:"are you happy",
            convo:[
              {f:'me', t:"are you happy"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"yeah", ms:800},
              {f:'me', t:"what changed", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you happened", ms:1400},
              {f:'me', t:"jay", ms:400},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"the song's done by the way", ms:1000},
              {f:'me', t:"the one with my name in it", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah", ms:800},
              {f:'read', time:'11:49 PM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:55 PM',
        options:[
          { label:"you developed the photo",
            convo:[
              {f:'me', t:"you developed the photo"},
              {f:'them', t:"yeah", ms:1400},
              {f:'me', t:"which one", ms:500},
              {f:'them', t:"the one from the first stage", ms:1600},
              {f:'me', t:"can i see it", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i put it under your door an hour ago", ms:1200},
              {f:'me', t:"...", ms:700},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"it's yours", ms:1400},
              {f:'me', t:"i was looking at it when you texted", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i know. i could see the light under your door", ms:1400},
              {f:'read', time:'12:01 AM'}
            ], fx:{FINN_TRUST:3} },
          { label:"are you on the roof",
            convo:[
              {f:'me', t:"are you on the roof"},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"i'm coming up", ms:500},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"i was hoping you'd say that", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'me', t:"how long have you been up there", ms:500},
              {f:'them', t:"a while", ms:1400},
              {f:'me', t:"were you waiting for me", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"yeah", ms:1000},
              {f:'read', time:'11:51 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    29: {
      KAIN: { time:'12:18 AM',
        options:[
          { label:"one more left",
            convo:[
              {f:'me', t:"one more left"},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i know", ms:800},
              {f:'me', t:"how does that feel", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like i don't want to get to the last day", ms:1600},
              {f:'me', t:"we're not there yet", ms:500},
              {f:'them', t:"no", ms:800},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"when it ends. don't disappear", ms:1600},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"i mean it", ms:1200},
              {f:'read', time:'12:24 AM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"i've been thinking about this year",
            convo:[
              {f:'me', t:"i've been thinking about this year"},
              {f:'them', t:"me too", ms:1400},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i used to think i didn't need anyone in this beside me", ms:1800},
              {f:'me', t:"and now", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"and now i check my phone to see if you've texted", ms:1600},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"don't make it weird", ms:1200},
              {f:'me', t:"already did", ms:400},
              {f:'read', time:'12:26 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:58 PM',
        options:[
          { label:"i don't want it to end",
            convo:[
              {f:'me', t:"i don't want it to end"},
              {f:'them', t:"it's not ending", ms:900},
              {f:'me', t:"one more episode", ms:600},
              {f:'them', t:"we exist past the last page", ms:1200},
              {f:'me', t:"theo", ms:500},
              {f:'them', t:"i mean it", ms:800},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"you're in every version of what comes next for me", ms:1400},
              {f:'me', t:"...", ms:700},
              {f:'them', t:"every single one", ms:800},
              {f:'read', time:'12:03 AM'}
            ], fx:{THEO_TRUST:3} },
          { label:"you've meant a lot to me this year",
            convo:[
              {f:'me', t:"you've meant a lot to me this year"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"stop it i'm in the kitchen", ms:900},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"i know. i know okay.", ms:1400},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"you walked in and everything got easier", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'them', t:"i'm not done yet", ms:1000},
              {f:'them', t:"you make me feel like myself", ms:800},
              {f:'them', t:"i've been waiting to tell someone that", ms:500},
              {f:'read', time:'12:05 AM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'1:34 AM',
        options:[
          { label:"are you still awake",
            convo:[
              {f:'me', t:"are you still awake"},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"finishing it?", ms:600},
              {f:'them', t:"just did", ms:1400},
              {f:'me', t:"how does it end", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it ends with a question", ms:1400},
              {f:'me', t:"what question", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"one i want to ask you in person", ms:1600},
              {f:'read', time:'1:39 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"what does the last line say",
            convo:[
              {f:'me', t:"what does the last line say"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i finished it", ms:1200},
              {f:'me', t:"...", ms:600},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"it ends with your name", ms:1400},
              {f:'me', t:"jay", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"come find me tomorrow", ms:1200},
              {f:'read', time:'1:41 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'12:08 AM',
        options:[
          { label:"i've been looking at the photo you gave me",
            convo:[
              {f:'me', t:"i've been looking at the photo you gave me"},
              {f:'them', t:"yeah?", ms:1200},
              {f:'me', t:"we look like a group", ms:600},
              {f:'them', t:"you are", ms:1400},
              {f:'me', t:"i know. it's different seeing it", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i printed one for myself too", ms:1400},
              {f:'me', t:"which one", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"the one of just you", ms:1200},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"for when you're not around", ms:1000},
              {f:'read', time:'12:13 AM'}
            ], fx:{FINN_TRUST:3} },
          { label:"thank you for seeing me",
            convo:[
              {f:'me', t:"thank you for seeing me"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"don't thank me", ms:900},
              {f:'me', t:"why not", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i couldn't stop if i wanted to", ms:1400},
              {f:'read', time:'12:11 AM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    1: {
      KAIN: { time:'11:22 PM',
        options:[
          { label:"you were watching me today",
            convo:[
              {f:'me', t:"you were watching me today"},
              {f:'them', t:"everyone was watching you", ms:1400},
              {f:'me', t:"not like you were", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you noticed", ms:1000},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"good", ms:800},
              {f:'read', time:'11:25 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"first day. how'd i do",
            convo:[
              {f:'me', t:"first day. how'd i do"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"you want honest", ms:1200},
              {f:'me', t:"always", ms:500},
              {f:'them', t:"you held back", ms:1400},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"don't do that tomorrow", ms:1000},
              {f:'read', time:'11:26 PM'}
            ], fx:{KAIN_TRUST:1} }
        ]},
      THEO: { time:'11:10 PM',
        options:[
          { label:"can you believe we're actually here",
            convo:[
              {f:'me', t:"can you believe we're actually here"},
              {f:'them', t:"NO i keep having to remind myself it's real", ms:700},
              {f:'them', t:"like i pinched myself in the elevator", ms:500},
              {f:'me', t:"did it work", ms:600},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"a little. you help more though", ms:1200},
              {f:'me', t:"me?", ms:400},
              {f:'them', t:"seeing you here makes it feel real", ms:1400},
              {f:'read', time:'11:14 PM'}
            ], fx:{THEO_TRUST:1} },
          { label:"i'm glad you were there today",
            convo:[
              {f:'me', t:"i'm glad you were there today"},
              {f:'them', t:"!!!! same", ms:600},
              {f:'them', t:"i was so scared walking in and then i saw you and i was like okay", ms:900},
              {f:'me', t:"okay what", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"okay i can do this", ms:1200},
              {f:'read', time:'11:13 PM'}
            ], fx:{THEO_TRUST:1} }
        ]},
      JAY: { time:'11:35 PM',
        options:[
          { label:"you didn't introduce yourself to anyone",
            convo:[
              {f:'me', t:"you didn't introduce yourself to anyone"},
              {f:'them', t:"they'll figure out who i am", ms:1600},
              {f:'me', t:"that's not what i meant", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i know what you meant", ms:1200},
              {f:'me', t:"so", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i introduced myself to you", ms:1400},
              {f:'read', time:'11:39 PM'}
            ], fx:{JAY_TRUST:1} },
          { label:"do you always go quiet when it's loud",
            convo:[
              {f:'me', t:"do you always go quiet when it's loud"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"how'd you notice that", ms:1400},
              {f:'me', t:"i was paying attention", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i'll have to be more careful", ms:1200},
              {f:'me', t:"or less", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"maybe", ms:800},
              {f:'read', time:'11:40 PM'}
            ], fx:{JAY_TRUST:1} }
        ]},
      FINN: { time:'11:18 PM',
        options:[
          { label:"you've been taking photos all day",
            convo:[
              {f:'me', t:"you've been taking photos all day"},
              {f:'them', t:"yeah", ms:1200},
              {f:'me', t:"of me too?", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"a few", ms:900},
              {f:'me', t:"can i see", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"not yet", ms:800},
              {f:'read', time:'11:21 PM'}
            ], fx:{FINN_TRUST:1} },
          { label:"what's the first thing you noticed about this place",
            convo:[
              {f:'me', t:"what's the first thing you noticed about this place"},
              {f:'them', t:"the light in the practice room", ms:1400},
              {f:'me', t:"the light?", ms:600},
              {f:'them', t:"afternoon sun through the high windows", ms:1200},
              {f:'them', t:"it hits differently depending on where you stand", ms:800},
              {f:'me', t:"where did it hit you", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i was standing next to you", ms:1400},
              {f:'read', time:'11:22 PM'}
            ], fx:{FINN_TRUST:1} }
        ]}
    },
    3: {
      KAIN: { time:'12:02 AM',
        options:[
          { label:"you went back to the studio alone",
            convo:[
              {f:'me', t:"you went back to the studio alone"},
              {f:'them', t:"i had things to fix", ms:1400},
              {f:'me', t:"what things", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i lose count when you're in the room", ms:1600},
              {f:'me', t:"of what", ms:500},
              {f:'them', t:"counts. beats. the run-through.", ms:1200},
              {f:'them', t:"all of it", ms:600},
              {f:'read', time:'12:06 AM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"you're too hard on yourself",
            convo:[
              {f:'me', t:"you're too hard on yourself"},
              {f:'them', t:"am i", ms:1600},
              {f:'me', t:"yes", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"someone has to be", ms:1200},
              {f:'me', t:"why does it have to be you", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"because if i let go, everything falls", ms:1600},
              {f:'me', t:"i'd catch it", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'read', time:'12:07 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:48 PM',
        options:[
          { label:"jay noticed something about you today",
            convo:[
              {f:'me', t:"jay noticed something about you today"},
              {f:'them', t:"oh no what", ms:900},
              {f:'me', t:"said you sing sharper when you're nervous", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"that's actually accurate", ms:1200},
              {f:'me', t:"were you nervous today", ms:600},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"a little. you were watching", ms:1400},
              {f:'read', time:'11:52 PM'}
            ], fx:{THEO_TRUST:1} },
          { label:"you went extra hard in the second set",
            convo:[
              {f:'me', t:"you went extra hard in the second set"},
              {f:'them', t:"i messed up the first one", ms:1000},
              {f:'me', t:"you were the only one who noticed", ms:700},
              {f:'them', t:"you noticed too", ms:1200},
              {f:'me', t:"because i know what you sound like when you're in it", ms:800},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"when did you learn that", ms:1400},
              {f:'me', t:"i've been listening", ms:600},
              {f:'read', time:'11:53 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:14 AM',
        options:[
          { label:"what did you notice",
            convo:[
              {f:'me', t:"what did you notice"},
              {f:'them', t:"about what", ms:1400},
              {f:'me', t:"today. you had that look", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i noticed you hesitate before every choice", ms:1600},
              {f:'me', t:"is that bad", ms:600},
              {f:'them', t:"no", ms:1000},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"it means you're taking it seriously", ms:1400},
              {f:'read', time:'12:18 AM'}
            ], fx:{JAY_TRUST:1} },
          { label:"you looked at me like you were waiting for something",
            convo:[
              {f:'me', t:"you looked at me like you were waiting for something"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"i was", ms:900},
              {f:'me', t:"for what", ms:500},
              {f:'them', t:"to see which version of you would show up today", ms:1600},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i liked this one best so far", ms:1200},
              {f:'read', time:'12:19 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:55 PM',
        options:[
          { label:"delete the bad ones",
            convo:[
              {f:'me', t:"delete the bad ones"},
              {f:'them', t:"there aren't any", ms:1400},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"i'm serious. there are just ones that show more than you want to", ms:1600},
              {f:'me', t:"like what", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"like how you look when you think no one's watching", ms:1400},
              {f:'me', t:"what do i look like", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like yourself", ms:1000},
              {f:'read', time:'11:59 PM'}
            ], fx:{FINN_TRUST:1} },
          { label:"what corner were you in today",
            convo:[
              {f:'me', t:"what corner were you in today"},
              {f:'them', t:"the one with the best angle", ms:1200},
              {f:'me', t:"of what", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you, mostly", ms:1000},
              {f:'read', time:'11:58 PM'}
            ], fx:{FINN_TRUST:1} }
        ]}
    },
    4: {
      KAIN: { time:'11:40 PM',
        options:[
          { label:"you barely said a word today",
            convo:[
              {f:'me', t:"you barely said a word today"},
              {f:'them', t:"i said what needed to be said", ms:1600},
              {f:'me', t:"and everything else", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"was for you to figure out", ms:1200},
              {f:'me', t:"i'm still figuring", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i know. i'll wait.", ms:1000},
              {f:'read', time:'11:44 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"what made you pick this corner",
            convo:[
              {f:'me', t:"what made you pick this corner"},
              {f:'them', t:"which corner", ms:1400},
              {f:'me', t:"the practice corner. you always go back to it", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i can see the full room from there", ms:1400},
              {f:'me', t:"and today?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i could see you", ms:1000},
              {f:'read', time:'11:45 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:30 PM',
        options:[
          { label:"finn went quiet after dinner",
            convo:[
              {f:'me', t:"finn went quiet after dinner"},
              {f:'them', t:"he does that sometimes", ms:1200},
              {f:'me', t:"you checked on him", ms:600},
              {f:'them', t:"of course i did! he's finn", ms:1000},
              {f:'me', t:"you always take care of everyone", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"not everyone", ms:1200},
              {f:'me', t:"who's the exception", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"you. you take care of yourself fine", ms:1400},
              {f:'me', t:"do i", ms:400},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you could let someone help though", ms:1200},
              {f:'read', time:'11:35 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you were talking to finn for a long time",
            convo:[
              {f:'me', t:"you were talking to finn for a long time"},
              {f:'them', t:"he needed to hear some things", ms:1200},
              {f:'me', t:"like what", ms:600},
              {f:'them', t:"that he belongs here", ms:1400},
              {f:'me', t:"does he not believe that", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"do you?", ms:1000},
              {f:'me', t:"believe he belongs?", ms:600},
              {f:'them', t:"believe YOU belong", ms:1200},
              {f:'me', t:"...", ms:1800},
              {f:'them', t:"i thought so", ms:1200},
              {f:'them', t:"you do. i need you to know that", ms:1000},
              {f:'read', time:'11:36 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:05 AM',
        options:[
          { label:"you've been writing again",
            convo:[
              {f:'me', t:"you've been writing again"},
              {f:'them', t:"how'd you know", ms:1400},
              {f:'me', t:"you had ink on your hand all day", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"observant", ms:900},
              {f:'me', t:"what are you writing about", ms:700},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"things that are hard to say out loud", ms:1400},
              {f:'me', t:"like what", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like this", ms:800},
              {f:'read', time:'12:09 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"you disappeared during lunch",
            convo:[
              {f:'me', t:"you disappeared during lunch"},
              {f:'them', t:"i needed quiet", ms:1400},
              {f:'me', t:"from who", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"not from you", ms:1200},
              {f:'read', time:'12:07 AM'}
            ], fx:{JAY_TRUST:1} }
        ]},
      FINN: { time:'11:22 PM',
        options:[
          { label:"what's in finn's corner",
            convo:[
              {f:'me', t:"what's in finn's corner"},
              {f:'them', t:"just some stuff", ms:1200},
              {f:'me', t:"can i see", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"[photo: a small corner with one polaroid taped to the wall and a camera strap]", ms:1000},
              {f:'me', t:"whose polaroid", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i took it on the first day", ms:1400},
              {f:'me', t:"it's me", ms:400},
              {f:'them', t:"yeah", ms:900},
              {f:'read', time:'11:26 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"you set up your own little corner in there",
            convo:[
              {f:'me', t:"you set up your own little corner in there"},
              {f:'them', t:"is that weird", ms:1400},
              {f:'me', t:"it's very you", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"what does that mean", ms:1000},
              {f:'me', t:"quiet. careful. everything placed on purpose", ms:800},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i have a photo of you in there", ms:1400},
              {f:'me', t:"i know. i saw.", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"okay", ms:600},
              {f:'read', time:'11:27 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    6: {
      KAIN: { time:'12:17 AM',
        options:[
          { label:"kain. it's midnight",
            convo:[
              {f:'me', t:"kain. it's midnight"},
              {f:'them', t:"i know", ms:1200},
              {f:'me', t:"you're still in there", ms:600},
              {f:'them', t:"i heard you walk past the door", ms:1600},
              {f:'me', t:"...", ms:1400},
              {f:'me', t:"i wasn't going to knock", ms:700},
              {f:'them', t:"why not", ms:1200},
              {f:'me', t:"thought you wanted to be alone", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"not from you", ms:1000},
              {f:'read', time:'12:21 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"what do you do when you can't sleep",
            convo:[
              {f:'me', t:"what do you do when you can't sleep"},
              {f:'them', t:"work", ms:1400},
              {f:'me', t:"always?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"lately i just sit", ms:1200},
              {f:'me', t:"and think about what", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"things i can't control", ms:1400},
              {f:'me', t:"like", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"like how i feel when you walk into a room", ms:1600},
              {f:'read', time:'12:22 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'12:04 AM',
        options:[
          { label:"you're still awake",
            convo:[
              {f:'me', t:"you're still awake"},
              {f:'them', t:"so are you!!", ms:700},
              {f:'me', t:"i can't sleep", ms:600},
              {f:'them', t:"me neither. i've been just lying here thinking", ms:1000},
              {f:'me', t:"about what", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"things i want to say to you but i don't know how", ms:1600},
              {f:'me', t:"try", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you make it easier to be here", ms:1400},
              {f:'read', time:'12:08 AM'}
            ], fx:{THEO_TRUST:2} },
          { label:"are you okay. really",
            convo:[
              {f:'me', t:"are you okay. really"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"not totally", ms:1000},
              {f:'me', t:"what happened", ms:600},
              {f:'them', t:"kain said something that stuck", ms:1400},
              {f:'me', t:"good stuck or bad stuck", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"true stuck", ms:1000},
              {f:'me', t:"tell me", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"he said i smile too fast. like i'm trying to fix things before they break", ms:1800},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"is that what i do", ms:1000},
              {f:'read', time:'12:09 AM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:33 AM',
        options:[
          { label:"you're awake at midnight again",
            convo:[
              {f:'me', t:"you're awake at midnight again"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"does it bother you", ms:1200},
              {f:'me', t:"it makes me want to stay up with you", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"why", ms:900},
              {f:'me', t:"in case you need someone", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i don't usually", ms:1200},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"but maybe tonight", ms:1000},
              {f:'read', time:'12:37 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"what do you write at midnight",
            convo:[
              {f:'me', t:"what do you write at midnight"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"lines that won't survive morning", ms:1400},
              {f:'me', t:"why not", ms:500},
              {f:'them', t:"too honest", ms:1200},
              {f:'me', t:"save one for me", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i already did", ms:1000},
              {f:'read', time:'12:35 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'12:10 AM',
        options:[
          { label:"still editing at midnight",
            convo:[
              {f:'me', t:"still editing at midnight"},
              {f:'them', t:"the light's better after twelve", ms:1400},
              {f:'me', t:"what light. you're inside", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"the quiet", ms:1000},
              {f:'them', t:"it's easier to see things clearly when everything's still", ms:1400},
              {f:'me', t:"is that why you're still up", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"partly", ms:900},
              {f:'me', t:"and the other part", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i was waiting to see if you'd text", ms:1400},
              {f:'read', time:'12:14 AM'}
            ], fx:{FINN_TRUST:2} },
          { label:"send me something you took today",
            convo:[
              {f:'me', t:"send me something you took today"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"[photo: practice room empty, shoes by the door, one jacket on the hook]", ms:1000},
              {f:'me', t:"whose jacket", ms:600},
              {f:'them', t:"yours", ms:1200},
              {f:'me', t:"you photographed my jacket", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i photograph things that matter to me", ms:1400},
              {f:'read', time:'12:13 AM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    7: {
      KAIN: { time:'11:50 PM',
        options:[
          { label:"you went quiet in the group chat",
            convo:[
              {f:'me', t:"you went quiet in the group chat"},
              {f:'them', t:"i said what i needed to", ms:1600},
              {f:'me', t:"you said one word", ms:700},
              {f:'them', t:"it was enough", ms:1400},
              {f:'me', t:"was it really", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"there are things i don't say in groups", ms:1600},
              {f:'me', t:"only to me?", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"still deciding", ms:900},
              {f:'read', time:'11:54 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"the group doesn't know what you're actually like",
            convo:[
              {f:'me', t:"the group doesn't know what you're actually like"},
              {f:'them', t:"neither do you", ms:1400},
              {f:'me', t:"i'm getting closer", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you're the only one trying", ms:1400},
              {f:'me', t:"is that okay", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"yeah", ms:800},
              {f:'read', time:'11:55 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:38 PM',
        options:[
          { label:"theo you sent that meme to the wrong chat",
            convo:[
              {f:'me', t:"theo you sent that meme to the wrong chat"},
              {f:'them', t:"WAIT WHICH ONE", ms:400},
              {f:'me', t:"the group one", ms:500},
              {f:'them', t:"NOOOOO i meant to send it to you only", ms:600},
              {f:'me', t:"it's fine i thought it was funny", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"it was about you", ms:1200},
              {f:'me', t:"i know. that's why it was funny", ms:700},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you're not mad", ms:1000},
              {f:'me', t:"why would i be mad that you think about me", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'read', time:'11:43 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you talk differently in the group than with me",
            convo:[
              {f:'me', t:"you talk differently in the group than with me"},
              {f:'them', t:"does everyone not do that", ms:1200},
              {f:'me', t:"you're more you with me", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"that's the highest compliment you could give me", ms:1600},
              {f:'me', t:"i meant it as one", ms:600},
              {f:'read', time:'11:42 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:02 AM',
        options:[
          { label:"you didn't reply to a single thing in the groupchat",
            convo:[
              {f:'me', t:"you didn't reply to a single thing in the groupchat"},
              {f:'them', t:"i was reading", ms:1600},
              {f:'me', t:"for two hours?", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i was watching you type and delete things", ms:1400},
              {f:'me', t:"you could see that", ms:700},
              {f:'them', t:"yeah", ms:1000},
              {f:'me', t:"why didn't you say something", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i wanted to see what you'd decide", ms:1400},
              {f:'read', time:'12:06 AM'}
            ], fx:{JAY_TRUST:1} },
          { label:"would you ever say something real in the group",
            convo:[
              {f:'me', t:"would you ever say something real in the group"},
              {f:'them', t:"define real", ms:1400},
              {f:'me', t:"something that matters to you", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i texted you separately", ms:1200},
              {f:'me', t:"...", ms:800},
              {f:'me', t:"yeah you did", ms:600},
              {f:'them', t:"that's my version of saying something real", ms:1400},
              {f:'read', time:'12:05 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:44 PM',
        options:[
          { label:"your photos from today hit different",
            convo:[
              {f:'me', t:"your photos from today hit different"},
              {f:'them', t:"which ones", ms:1400},
              {f:'me', t:"the candid ones. in the groupchat", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i didn't share all of them", ms:1400},
              {f:'me', t:"which ones did you keep", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"the ones of you", ms:1000},
              {f:'read', time:'11:48 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"finn you're so quiet in groups",
            convo:[
              {f:'me', t:"finn you're so quiet in groups"},
              {f:'them', t:"i prefer one on one", ms:1400},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"in groups people perform. they're not real.", ms:1600},
              {f:'me', t:"and one on one", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"people show you who they are when it's just you", ms:1400},
              {f:'me', t:"who am i", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"still finding out. i like that part.", ms:1400},
              {f:'read', time:'11:49 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    9: {
      KAIN: { time:'11:55 PM',
        options:[
          { label:"you pushed hard today",
            convo:[
              {f:'me', t:"you pushed hard today"},
              {f:'them', t:"not hard enough", ms:1600},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"there's always more to fix", ms:1400},
              {f:'me', t:"or there's already enough right", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you say that like it's easy", ms:1400},
              {f:'me', t:"i'm saying it because i mean it", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i'll think about it", ms:1000},
              {f:'read', time:'11:59 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"what are you listening to right now",
            convo:[
              {f:'me', t:"what are you listening to right now"},
              {f:'them', t:"nothing", ms:1200},
              {f:'me', t:"you always have something in", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i took them out when you texted", ms:1400},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"so i could focus", ms:1200},
              {f:'me', t:"on what", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you", ms:800},
              {f:'read', time:'12:00 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:42 PM',
        options:[
          { label:"you read jay's notebook didn't you",
            convo:[
              {f:'me', t:"you read jay's notebook didn't you"},
              {f:'them', t:"he LEFT it open!!", ms:700},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"okay i glanced. ONE glance.", ms:800},
              {f:'me', t:"what did you see", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"your name", ms:1000},
              {f:'me', t:"my name?", ms:500},
              {f:'them', t:"more than once", ms:1200},
              {f:'them', t:"...", ms:1600},
              {f:'them', t:"i think he really sees you", ms:1400},
              {f:'read', time:'11:46 PM'}
            ], fx:{THEO_TRUST:1} },
          { label:"what's going on with jay",
            convo:[
              {f:'me', t:"what's going on with jay"},
              {f:'them', t:"what do you mean", ms:1200},
              {f:'me', t:"he seems like he's working something out", ms:700},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"he always is", ms:1200},
              {f:'them', t:"but i think lately it's different", ms:800},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"because he started looking up more", ms:1400},
              {f:'me', t:"at what", ms:500},
              {f:'them', t:"you. mostly you.", ms:1200},
              {f:'read', time:'11:45 PM'}
            ], fx:{THEO_TRUST:1} }
        ]},
      JAY: { time:'12:28 AM',
        options:[
          { label:"you left your notebook in the hall",
            convo:[
              {f:'me', t:"you left your notebook in the hall"},
              {f:'them', t:"did you look inside", ms:1800},
              {f:'me', t:"no", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you could have", ms:1200},
              {f:'me', t:"it's yours", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"there's a page in there. the third one.", ms:1400},
              {f:'me', t:"...", ms:900},
              {f:'them', t:"if you want. you can read that one.", ms:1200},
              {f:'read', time:'12:32 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"what's in the notebook",
            convo:[
              {f:'me', t:"what's in the notebook"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"things i don't say", ms:1200},
              {f:'me', t:"ever?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"until now", ms:900},
              {f:'read', time:'12:30 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'12:01 AM',
        options:[
          { label:"i saw you and jay talking for a long time",
            convo:[
              {f:'me', t:"i saw you and jay talking for a long time"},
              {f:'them', t:"we were trading something", ms:1400},
              {f:'me', t:"what", ms:500},
              {f:'them', t:"i gave him a photo. he gave me a line from his notebook.", ms:1600},
              {f:'me', t:"what line", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it was about you", ms:1200},
              {f:'me', t:"me", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"we both think about you a lot", ms:1400},
              {f:'read', time:'12:05 AM'}
            ], fx:{FINN_TRUST:2} },
          { label:"what are you working on tonight",
            convo:[
              {f:'me', t:"what are you working on tonight"},
              {f:'them', t:"editing", ms:1200},
              {f:'me', t:"still?", ms:500},
              {f:'them', t:"i want to get it right", ms:1400},
              {f:'me', t:"which ones", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"the ones from yesterday. of you.", ms:1400},
              {f:'me', t:"what needs fixing", ms:600},
              {f:'them', t:"nothing. i just like looking at them.", ms:1400},
              {f:'read', time:'12:04 AM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    10: {
      KAIN: { time:'12:08 AM',
        options:[
          { label:"you flinched when he called your name wrong",
            convo:[
              {f:'me', t:"you flinched when he called your name wrong"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"it wasn't my name", ms:1200},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"you always catch things like that", ms:1400},
              {f:'me', t:"i'm paying attention", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i know. that's why i keep looking at you.", ms:1600},
              {f:'read', time:'12:12 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"does theo know what you're actually thinking",
            convo:[
              {f:'me', t:"does theo know what you're actually thinking"},
              {f:'them', t:"no one does", ms:1400},
              {f:'me', t:"not even me", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you get closer than most", ms:1400},
              {f:'me', t:"what's the rest", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"things i'm not ready for", ms:1200},
              {f:'me', t:"okay. i'll be here when you are.", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i know", ms:800},
              {f:'read', time:'12:13 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:56 PM',
        options:[
          { label:"theo. what are you not saying",
            convo:[
              {f:'me', t:"theo. what are you not saying"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"how do you know i'm not saying something", ms:1400},
              {f:'me', t:"you do this thing where you answer everything except the real question", ms:800},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"that's. wow.", ms:1200},
              {f:'me', t:"so what is it", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i think i like you more than i'm supposed to", ms:1600},
              {f:'read', time:'12:00 AM'}
            ], fx:{THEO_TRUST:3} },
          { label:"you were so quiet after practice",
            convo:[
              {f:'me', t:"you were so quiet after practice"},
              {f:'them', t:"i was just tired", ms:1200},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"okay i was thinking", ms:1200},
              {f:'me', t:"about what", ms:600},
              {f:'them', t:"about what happens if this ends", ms:1400},
              {f:'me', t:"it won't", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"promise me", ms:1200},
              {f:'me', t:"i promise", ms:500},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"okay. okay good.", ms:900},
              {f:'read', time:'11:59 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:44 AM',
        options:[
          { label:"what does theo not say",
            convo:[
              {f:'me', t:"what does theo not say"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"everything underneath the smile", ms:1400},
              {f:'me', t:"does he talk to you about it", ms:700},
              {f:'them', t:"sometimes. not all of it.", ms:1400},
              {f:'me', t:"do you talk to anyone about yours", ms:700},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"i'm trying to", ms:1200},
              {f:'me', t:"with me?", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah. with you.", ms:1000},
              {f:'read', time:'12:48 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"i can tell you hold things in",
            convo:[
              {f:'me', t:"i can tell you hold things in"},
              {f:'them', t:"most people can't", ms:1400},
              {f:'me', t:"i'm not most people", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"no. you're not.", ms:1200},
              {f:'read', time:'12:47 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:48 PM',
        options:[
          { label:"you looked far away all day",
            convo:[
              {f:'me', t:"you looked far away all day"},
              {f:'them', t:"i was here", ms:1400},
              {f:'me', t:"i know. but somewhere else too", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i was thinking about a photo i want to take", ms:1400},
              {f:'me', t:"of what", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"the way you look when you're not thinking about being looked at", ms:1600},
              {f:'me', t:"how do i look", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like someone worth staying for", ms:1400},
              {f:'read', time:'11:52 PM'}
            ], fx:{FINN_TRUST:3} },
          { label:"what does finn keep to himself",
            convo:[
              {f:'me', t:"what does finn keep to himself"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"most things", ms:1000},
              {f:'me', t:"except", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"except how i feel about you", ms:1400},
              {f:'them', t:"that part keeps coming out", ms:800},
              {f:'read', time:'11:51 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    12: {
      KAIN: { time:'11:33 PM',
        options:[
          { label:"finn showed me a photo of all of us",
            convo:[
              {f:'me', t:"finn showed me a photo of all of us"},
              {f:'them', t:"which one", ms:1400},
              {f:'me', t:"the one from rehearsal. you're in the back.", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i didn't know he took that", ms:1200},
              {f:'me', t:"you're looking at me in it", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"don't read into it", ms:1000},
              {f:'me', t:"i'm not. i just noticed.", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"okay", ms:700},
              {f:'read', time:'11:37 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"you're in every one of finn's shots somehow",
            convo:[
              {f:'me', t:"you're in every one of finn's shots somehow"},
              {f:'them', t:"i'm not avoiding the camera", ms:1400},
              {f:'me', t:"that's not what i said", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"what are you saying then", ms:1200},
              {f:'me', t:"finn keeps you in the frame even when you're not the subject", ms:800},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"he does that to you too", ms:1400},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"what do you make of it", ms:1200},
              {f:'me', t:"i think we're important to him", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah. i think we are.", ms:1200},
              {f:'read', time:'11:39 PM'}
            ], fx:{KAIN_TRUST:1} }
        ]},
      THEO: { time:'11:20 PM',
        options:[
          { label:"finn's photos made me emotional",
            convo:[
              {f:'me', t:"finn's photos made me emotional"},
              {f:'them', t:"SAME. okay i cried a little", ms:800},
              {f:'me', t:"which one got you", ms:600},
              {f:'them', t:"the one where we're all laughing and nobody knows they're being photographed", ms:1000},
              {f:'them', t:"we look so. real.", ms:800},
              {f:'me', t:"we are real", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i forget that sometimes. thank you for reminding me", ms:1600},
              {f:'read', time:'11:24 PM'}
            ], fx:{THEO_TRUST:1} },
          { label:"you were making faces at finn's camera all day",
            convo:[
              {f:'me', t:"you were making faces at finn's camera all day"},
              {f:'them', t:"i was giving him good content!!", ms:700},
              {f:'me', t:"he said you kept ruining the candids", ms:700},
              {f:'them', t:"he LOVES it he just won't admit it", ms:800},
              {f:'me', t:"true", ms:400},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"also i do it so he focuses on me and not just you", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"you're his favorite subject okay i have to compete", ms:1200},
              {f:'read', time:'11:24 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:11 AM',
        options:[
          { label:"finn wants to take a portrait of you",
            convo:[
              {f:'me', t:"finn wants to take a portrait of you"},
              {f:'them', t:"i know. i said no.", ms:1600},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"i don't like being looked at that directly", ms:1600},
              {f:'me', t:"but you let me", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"that's different", ms:1000},
              {f:'me', t:"how", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you look back", ms:1200},
              {f:'read', time:'12:15 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"what do you think of finn's work",
            convo:[
              {f:'me', t:"what do you think of finn's work"},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"he sees things other people miss", ms:1400},
              {f:'me', t:"like what", ms:500},
              {f:'them', t:"the moment before the moment", ms:1400},
              {f:'me', t:"what's ours", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i think he caught it already", ms:1200},
              {f:'me', t:"caught what", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"the exact second i started paying attention to you", ms:1600},
              {f:'read', time:'12:16 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:08 PM',
        options:[
          { label:"the photos you took today were beautiful",
            convo:[
              {f:'me', t:"the photos you took today were beautiful"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"which ones", ms:900},
              {f:'me', t:"all of them. but especially the ones of us.", ms:700},
              {f:'them', t:"we look good together", ms:1400},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i mean in the frame. composition-wise.", ms:1200},
              {f:'me', t:"sure", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"and also the other way", ms:1000},
              {f:'read', time:'11:12 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"can i keep one of the prints",
            convo:[
              {f:'me', t:"can i keep one of the prints"},
              {f:'them', t:"which one", ms:1400},
              {f:'me', t:"the one by the window", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i made that one for you", ms:1400},
              {f:'me', t:"you were going to give it to me anyway", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah", ms:800},
              {f:'read', time:'11:11 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    13: {
      KAIN: { time:'11:58 PM',
        options:[
          { label:"you pushed me harder than usual today",
            convo:[
              {f:'me', t:"you pushed me harder than usual today"},
              {f:'them', t:"you can handle it", ms:1400},
              {f:'me', t:"how do you know", ms:600},
              {f:'them', t:"because when it gets hard you go quiet and focus", ms:1600},
              {f:'them', t:"you don't break", ms:800},
              {f:'me', t:"...", ms:1000},
              {f:'me', t:"is that why you keep pushing", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i push because i believe in what you're becoming", ms:1600},
              {f:'read', time:'12:02 AM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"you were competing with me all day",
            convo:[
              {f:'me', t:"you were competing with me all day"},
              {f:'them', t:"i'm always competing", ms:1600},
              {f:'me', t:"not like today", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you raised the level. i had to match it.", ms:1600},
              {f:'me', t:"or beat it", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i've never wanted someone to push back before", ms:1400},
              {f:'me', t:"and now", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"don't stop", ms:900},
              {f:'read', time:'12:03 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:34 PM',
        options:[
          { label:"you looked upset after that critique",
            convo:[
              {f:'me', t:"you looked upset after that critique"},
              {f:'them', t:"i was fine", ms:1200},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"okay i wasn't fine. it stung.", ms:1200},
              {f:'me', t:"because of what they said or because i was watching", ms:800},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"both", ms:800},
              {f:'me', t:"i know you're better than the critique", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"say that again. slower.", ms:1200},
              {f:'read', time:'11:38 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you held your own today",
            convo:[
              {f:'me', t:"you held your own today"},
              {f:'them', t:"barely", ms:1000},
              {f:'me', t:"i watched. you were solid.", ms:700},
              {f:'them', t:"you don't have to say that", ms:1200},
              {f:'me', t:"i'm not saying it to make you feel better", ms:700},
              {f:'me', t:"i'm saying it because it's true", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"when you say it i actually believe it", ms:1400},
              {f:'read', time:'11:37 PM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:22 AM',
        options:[
          { label:"you and i keep ending up on opposite sides",
            convo:[
              {f:'me', t:"you and i keep ending up on opposite sides"},
              {f:'them', t:"of what", ms:1400},
              {f:'me', t:"everything. today. every decision.", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"does that bother you", ms:1200},
              {f:'me', t:"not really. i like knowing where you stand.", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"and i like that you stand somewhere", ms:1400},
              {f:'me', t:"opposite sides but same ground", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah", ms:800},
              {f:'read', time:'12:26 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"why do you always challenge me",
            convo:[
              {f:'me', t:"why do you always challenge me"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"because you don't back down", ms:1400},
              {f:'me', t:"so?", ms:400},
              {f:'them', t:"so it's the only way i know how to get close", ms:1600},
              {f:'me', t:"...", ms:1200},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"too much?", ms:900},
              {f:'me', t:"no", ms:400},
              {f:'read', time:'12:25 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:29 PM',
        options:[
          { label:"you were watching me and theo argue",
            convo:[
              {f:'me', t:"you were watching me and theo argue"},
              {f:'them', t:"i photograph conflict sometimes", ms:1400},
              {f:'me', t:"did you take one", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yes", ms:900},
              {f:'me', t:"show me", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"[photo: you mid-sentence, one hand up, eyes sharp, completely alive]", ms:1200},
              {f:'me', t:"i look intense", ms:600},
              {f:'them', t:"you look incredible", ms:1200},
              {f:'read', time:'11:33 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"did it bother you watching us fight",
            convo:[
              {f:'me', t:"did it bother you watching us fight"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it bothered me that you looked alone in it", ms:1400},
              {f:'me', t:"i was fine", ms:600},
              {f:'them', t:"i know you were fine", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i just wanted to stand next to you", ms:1400},
              {f:'read', time:'11:32 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    15: {
      KAIN: { time:'3:08 AM',
        options:[
          { label:"it's 3am. you should sleep",
            convo:[
              {f:'me', t:"it's 3am. you should sleep"},
              {f:'them', t:"so should you", ms:1600},
              {f:'me', t:"i can't", ms:600},
              {f:'them', t:"neither can i", ms:1200},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"what's keeping you up", ms:1200},
              {f:'me', t:"...", ms:1000},
              {f:'me', t:"you, kind of", ms:700},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"same", ms:800},
              {f:'read', time:'3:11 AM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"can't sleep either",
            convo:[
              {f:'me', t:"can't sleep either"},
              {f:'them', t:"how'd you know i was awake", ms:1600},
              {f:'me', t:"your light was on", ms:600},
              {f:'them', t:"you were looking at my room", ms:1400},
              {f:'me', t:"...", ms:1000},
              {f:'me', t:"the hall light. i was just walking.", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"sure", ms:800},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i'm glad you were", ms:1200},
              {f:'read', time:'3:12 AM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'3:02 AM',
        options:[
          { label:"theo it's 3am why are you texting me",
            convo:[
              {f:'me', t:"theo it's 3am why are you texting me"},
              {f:'them', t:"i had a thought and it couldn't wait", ms:700},
              {f:'me', t:"what thought", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i'm really glad you're here", ms:1400},
              {f:'me', t:"you woke me up for that", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i didn't want to forget to say it", ms:1200},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"goodnight!! sorry!! sleep well!!", ms:600},
              {f:'read', time:'3:04 AM'}
            ], fx:{THEO_TRUST:2} },
          { label:"what's jay doing at 3am",
            convo:[
              {f:'me', t:"what's jay doing at 3am"},
              {f:'them', t:"probably writing", ms:1200},
              {f:'me', t:"that's what i thought", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"does it worry you", ms:1200},
              {f:'me', t:"a little. he gets too in his head.", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"you notice everything about him", ms:1400},
              {f:'me', t:"i notice everything about all of you", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"that's not the same thing. you know that.", ms:1400},
              {f:'read', time:'3:06 AM'}
            ], fx:{THEO_TRUST:1} }
        ]},
      JAY: { time:'3:14 AM',
        options:[
          { label:"jay. 3am. what are you writing",
            convo:[
              {f:'me', t:"jay. 3am. what are you writing"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"something honest", ms:1200},
              {f:'me', t:"about what", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"about how this feels", ms:1200},
              {f:'me', t:"this?", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you. texting me at 3am.", ms:1200},
              {f:'them', t:"me answering in three seconds.", ms:600},
              {f:'read', time:'3:18 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"are you okay",
            convo:[
              {f:'me', t:"are you okay"},
              {f:'them', t:"why", ms:1800},
              {f:'me', t:"3am. you always disappear at 3am.", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"you track my hours", ms:1200},
              {f:'me', t:"i notice when you're gone", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i'm okay", ms:900},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"better now", ms:800},
              {f:'read', time:'3:17 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'3:00 AM',
        options:[
          { label:"finn what are you still doing up",
            convo:[
              {f:'me', t:"finn what are you still doing up"},
              {f:'them', t:"editing", ms:1200},
              {f:'me', t:"at 3am?", ms:500},
              {f:'them', t:"the photos from today", ms:1400},
              {f:'me', t:"send me one", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"[photo: hallway at night. your door, slightly open. light underneath it.]", ms:1000},
              {f:'me', t:"you photographed my door", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i walk past it sometimes", ms:1200},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"go to sleep", ms:900},
              {f:'read', time:'3:04 AM'}
            ], fx:{FINN_TRUST:3} },
          { label:"you can't sleep either",
            convo:[
              {f:'me', t:"you can't sleep either"},
              {f:'them', t:"no", ms:1200},
              {f:'me', t:"what are you thinking about", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you, mostly", ms:1000},
              {f:'me', t:"finn", ms:400},
              {f:'them', t:"i know. i know.", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i just can't stop", ms:1000},
              {f:'read', time:'3:03 AM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    16: {
      KAIN: { time:'11:44 PM',
        options:[
          { label:"what's your version of today",
            convo:[
              {f:'me', t:"what's your version of today"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"my version is different from everyone else's", ms:1400},
              {f:'me', t:"tell me yours", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i kept watching you choose", ms:1200},
              {f:'them', t:"every small decision. the way you weigh things.", ms:1000},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i wanted to be the thing you chose", ms:1400},
              {f:'read', time:'11:48 PM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"why does your version always sound colder",
            convo:[
              {f:'me', t:"why does your version always sound colder"},
              {f:'them', t:"because i don't dress it up", ms:1600},
              {f:'me', t:"is there something underneath it", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"there's always something underneath it", ms:1400},
              {f:'me', t:"show me", ms:500},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i care more than i let on", ms:1400},
              {f:'them', t:"about this. about you.", ms:600},
              {f:'read', time:'11:49 PM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:28 PM',
        options:[
          { label:"why does kain's version always win",
            convo:[
              {f:'me', t:"why does kain's version always win"},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"because he's usually right", ms:1200},
              {f:'me', t:"even when it stings", ms:600},
              {f:'them', t:"especially when it stings", ms:1200},
              {f:'me', t:"does it bother you", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it used to", ms:1000},
              {f:'them', t:"but i trust that he wants us to be better", ms:1200},
              {f:'me', t:"you give him a lot", ms:600},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i give everyone a lot", ms:1200},
              {f:'them', t:"i wish someone would give it back", ms:800},
              {f:'me', t:"i'm trying", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i know", ms:800},
              {f:'read', time:'11:33 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"theo. what did today mean to you",
            convo:[
              {f:'me', t:"theo. what did today mean to you"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it meant you chose to stay", ms:1400},
              {f:'me', t:"i'm not going anywhere", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i know. but some days it hits different.", ms:1400},
              {f:'me', t:"what was different today", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you looked at me like i mattered", ms:1400},
              {f:'me', t:"you do", ms:500},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"okay. goodnight.", ms:900},
              {f:'read', time:'11:31 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:18 AM',
        options:[
          { label:"what's your version of us",
            convo:[
              {f:'me', t:"what's your version of us"},
              {f:'them', t:"...", ms:3600},
              {f:'them', t:"two people who keep finding each other", ms:1600},
              {f:'me', t:"in the same room", ms:600},
              {f:'them', t:"in any room", ms:1200},
              {f:'me', t:"...", ms:1000},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i've started looking for you first", ms:1400},
              {f:'them', t:"when i walk in somewhere", ms:600},
              {f:'read', time:'12:22 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"do you ever let anyone see your version of things",
            convo:[
              {f:'me', t:"do you ever let anyone see your version of things"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i'm letting you", ms:1200},
              {f:'me', t:"right now?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"every time i answer you", ms:1200},
              {f:'read', time:'12:20 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:52 PM',
        options:[
          { label:"what does finn's version of today look like",
            convo:[
              {f:'me', t:"what does finn's version of today look like"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"[photo: you walking ahead, half in shadow, everyone else blurred behind you]", ms:1200},
              {f:'me', t:"i'm alone in it", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"you were ahead", ms:1000},
              {f:'them', t:"the rest of us were following", ms:800},
              {f:'me', t:"that's not how it felt", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"that's how it looked from where i was standing", ms:1400},
              {f:'read', time:'11:56 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"you see everything through a lens",
            convo:[
              {f:'me', t:"you see everything through a lens"},
              {f:'them', t:"it's just how i process", ms:1400},
              {f:'me', t:"does it feel distant", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"sometimes", ms:900},
              {f:'me', t:"not with me?", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"with you i keep setting it down", ms:1400},
              {f:'read', time:'11:55 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    18: {
      KAIN: { time:'11:10 PM',
        options:[
          { label:"tomorrow's the one that counts",
            convo:[
              {f:'me', t:"tomorrow's the one that counts"},
              {f:'them', t:"every day counts", ms:1400},
              {f:'me', t:"you know what i mean", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i know", ms:900},
              {f:'me', t:"nervous?", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"not for myself", ms:1200},
              {f:'me', t:"for who", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"for you", ms:900},
              {f:'me', t:"why", ms:400},
              {f:'them', t:"because it matters to you. and i don't want you to carry that alone.", ms:1600},
              {f:'read', time:'11:14 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"what do you do the night before",
            convo:[
              {f:'me', t:"what do you do the night before"},
              {f:'them', t:"run it once in my head. then stop.", ms:1400},
              {f:'me', t:"why stop", ms:600},
              {f:'them', t:"if i keep running it i find things to fix and there's no time left", ms:1600},
              {f:'me', t:"so you just trust it", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i trust the work", ms:1200},
              {f:'me', t:"and the people?", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i trust you", ms:1000},
              {f:'read', time:'11:14 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'10:58 PM',
        options:[
          { label:"i can't sleep and it's not even midnight",
            convo:[
              {f:'me', t:"i can't sleep and it's not even midnight"},
              {f:'them', t:"ME NEITHER", ms:500},
              {f:'them', t:"i've been lying here for an hour", ms:600},
              {f:'me', t:"are you scared", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"terrified", ms:1000},
              {f:'me', t:"same", ms:400},
              {f:'them', t:"good. at least we're terrified together.", ms:1200},
              {f:'them', t:"...", ms:1800},
              {f:'them', t:"you're going to be great tomorrow", ms:1400},
              {f:'me', t:"how do you know", ms:600},
              {f:'them', t:"because i'll be watching and that always makes you better", ms:1400},
              {f:'read', time:'11:02 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"one thing you want tomorrow",
            convo:[
              {f:'me', t:"one thing you want tomorrow"},
              {f:'them', t:"for everyone to be okay after", ms:1200},
              {f:'me', t:"that's not for you that's for everyone", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"for you to look at me during the hardest part", ms:1400},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"so i know i'm not alone in it", ms:1200},
              {f:'me', t:"i'll look. i promise.", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"okay. i can do it then.", ms:1000},
              {f:'read', time:'11:03 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'11:28 PM',
        options:[
          { label:"are you ready for tomorrow",
            convo:[
              {f:'me', t:"are you ready for tomorrow"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i'm never ready", ms:1200},
              {f:'me', t:"but you always show up", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"yeah", ms:800},
              {f:'me', t:"that's the same thing", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i hadn't thought of it that way", ms:1200},
              {f:'me', t:"now you can sleep", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"maybe", ms:800},
              {f:'them', t:"goodnight", ms:600},
              {f:'read', time:'11:32 PM'}
            ], fx:{JAY_TRUST:2} },
          { label:"what did you write tonight",
            convo:[
              {f:'me', t:"what did you write tonight"},
              {f:'them', t:"something i needed to get out before tomorrow", ms:1600},
              {f:'me', t:"can i know what", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"that whatever happens. i'm glad we're here.", ms:1600},
              {f:'me', t:"all of us?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you specifically", ms:1000},
              {f:'read', time:'11:31 PM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:04 PM',
        options:[
          { label:"what photo would you take of tonight",
            convo:[
              {f:'me', t:"what photo would you take of tonight"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"all of us in the same building. knowing what tomorrow is.", ms:1600},
              {f:'me', t:"that's not really a photo", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"it would be if i could get everyone in the same room", ms:1400},
              {f:'me', t:"what would you want it to capture", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"that we chose this", ms:1000},
              {f:'them', t:"even knowing how hard it is", ms:800},
              {f:'read', time:'11:08 PM'}
            ], fx:{FINN_TRUST:1} },
          { label:"are you nervous",
            convo:[
              {f:'me', t:"are you nervous"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"yes", ms:900},
              {f:'me', t:"about the stage or something else", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"about what happens after", ms:1200},
              {f:'me', t:"what do you mean", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i don't want things to change", ms:1400},
              {f:'me', t:"between us?", ms:500},
              {f:'them', t:"between all of it. but. yeah. between us especially.", ms:1600},
              {f:'read', time:'11:08 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    19: {
      KAIN: { time:'12:34 AM',
        options:[
          { label:"kain. talk to me.",
            convo:[
              {f:'me', t:"kain. talk to me."},
              {f:'them', t:"...", ms:4000},
              {f:'them', t:"i'm fine", ms:900},
              {f:'me', t:"you're not fine. i can tell.", ms:700},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i cracked today", ms:1200},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"i don't crack", ms:1400},
              {f:'me', t:"everyone does", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"not in front of people", ms:1200},
              {f:'me', t:"just me", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"you don't count", ms:1000},
              {f:'me', t:"is that good or bad", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it's just true", ms:900},
              {f:'read', time:'12:39 AM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"what broke today",
            convo:[
              {f:'me', t:"what broke today"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"i did. a little.", ms:1200},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"don't say anything", ms:1400},
              {f:'me', t:"okay", ms:400},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"just. stay on the line.", ms:1200},
              {f:'me', t:"i'm here", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"okay", ms:800},
              {f:'read', time:'12:38 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'12:10 AM',
        options:[
          { label:"are you okay after today",
            convo:[
              {f:'me', t:"are you okay after today"},
              {f:'them', t:"i'm fine i promise!!", ms:800},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i'm scared that kain won't be okay", ms:1400},
              {f:'me', t:"he will be. we'll make sure.", ms:700},
              {f:'them', t:"we?", ms:1000},
              {f:'me', t:"you and me", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah. okay. we.", ms:1200},
              {f:'read', time:'12:14 AM'}
            ], fx:{THEO_TRUST:2} },
          { label:"you held kain together today",
            convo:[
              {f:'me', t:"you held kain together today"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"someone had to", ms:1000},
              {f:'me', t:"how are you", ms:600},
              {f:'them', t:"tired", ms:1200},
              {f:'me', t:"who holds you", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i was hoping it was you", ms:1400},
              {f:'me', t:"it is", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"good. i needed to hear that.", ms:1200},
              {f:'read', time:'12:15 AM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:48 AM',
        options:[
          { label:"do you think kain's going to be okay",
            convo:[
              {f:'me', t:"do you think kain's going to be okay"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"eventually", ms:1000},
              {f:'me', t:"that's not very reassuring", ms:700},
              {f:'them', t:"it's honest", ms:1200},
              {f:'me', t:"...", ms:1000},
              {f:'them', t:"he broke because he cares too much", ms:1400},
              {f:'them', t:"people like that rebuild harder", ms:800},
              {f:'me', t:"have you broken before", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"quietly. yeah.", ms:1000},
              {f:'me', t:"was there someone", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"there is now", ms:1000},
              {f:'read', time:'12:52 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"tonight was a lot",
            convo:[
              {f:'me', t:"tonight was a lot"},
              {f:'them', t:"yeah", ms:1400},
              {f:'me', t:"you okay?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i'm better when i can check in with you", ms:1400},
              {f:'me', t:"check in then", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i'm here. i'm safe. i saw you today.", ms:1400},
              {f:'them', t:"that's enough.", ms:600},
              {f:'read', time:'12:51 AM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'12:20 AM',
        options:[
          { label:"i've never seen kain like that before",
            convo:[
              {f:'me', t:"i've never seen kain like that before"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i have. once.", ms:1000},
              {f:'me', t:"what happened", ms:600},
              {f:'them', t:"he pushed too hard and the whole thing collapsed", ms:1400},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"i took a photo of him after. when he didn't know.", ms:1400},
              {f:'me', t:"of him breaking?", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"of him being human", ms:1200},
              {f:'them', t:"i never showed him. but i kept it.", ms:800},
              {f:'read', time:'12:24 AM'}
            ], fx:{FINN_TRUST:1} },
          { label:"how are you doing after all that",
            convo:[
              {f:'me', t:"how are you doing after all that"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"shaken", ms:1000},
              {f:'me', t:"me too", ms:500},
              {f:'them', t:"i keep thinking about what would happen if we lost one of us", ms:1600},
              {f:'me', t:"we won't", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"don't go anywhere", ms:1200},
              {f:'me', t:"i'm not going anywhere", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i know. i just needed to say it.", ms:1200},
              {f:'read', time:'12:24 AM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    21: {
      KAIN: { time:'11:40 PM',
        options:[
          { label:"did you read what jay wrote",
            convo:[
              {f:'me', t:"did you read what jay wrote"},
              {f:'them', t:"parts of it", ms:1400},
              {f:'me', t:"and", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"he sees things clearly", ms:1200},
              {f:'me', t:"about you?", ms:500},
              {f:'them', t:"about all of us", ms:1200},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"about you most of all", ms:1400},
              {f:'me', t:"what did he write about me", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"ask him. some things aren't mine to share.", ms:1400},
              {f:'read', time:'11:44 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"you've been different since jay showed you his writing",
            convo:[
              {f:'me', t:"you've been different since jay showed you his writing"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"have i", ms:1000},
              {f:'me', t:"yeah. softer.", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"there are things in there that i felt but didn't have words for", ms:1600},
              {f:'me', t:"like what", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like how it feels to want something but not know if you should", ms:1600},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it's about you. he wrote about you.", ms:1200},
              {f:'read', time:'11:46 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:22 PM',
        options:[
          { label:"jay's writing made me cry",
            convo:[
              {f:'me', t:"jay's writing made me cry"},
              {f:'them', t:"SAME", ms:500},
              {f:'them', t:"okay i full cried not just a little", ms:700},
              {f:'me', t:"the part about the group?", ms:600},
              {f:'them', t:"the part about you", ms:1200},
              {f:'me', t:"...", ms:1000},
              {f:'them', t:"he described you as 'the person everyone becomes more honest around'", ms:1400},
              {f:'them', t:"i've never read something that felt more true", ms:800},
              {f:'read', time:'11:26 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"did you know jay felt that way",
            convo:[
              {f:'me', t:"did you know jay felt that way"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i guessed. it's different seeing it written though.", ms:1400},
              {f:'me', t:"he's never said it out loud", ms:700},
              {f:'them', t:"that's just jay", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"but the writing is him saying it", ms:1400},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i think you should tell him you read it", ms:1400},
              {f:'me', t:"and say what", ms:600},
              {f:'them', t:"that you felt it too", ms:1200},
              {f:'read', time:'11:26 PM'}
            ], fx:{THEO_TRUST:1} }
        ]},
      JAY: { time:'12:30 AM',
        options:[
          { label:"you shared your writing",
            convo:[
              {f:'me', t:"you shared your writing"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i was tired of keeping it", ms:1200},
              {f:'me', t:"it's beautiful", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"did you read the part about you", ms:1400},
              {f:'me', t:"yes", ms:400},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"okay", ms:800},
              {f:'me', t:"jay", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i meant all of it", ms:1200},
              {f:'read', time:'12:34 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"why did you finally share it",
            convo:[
              {f:'me', t:"why did you finally share it"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"because i was afraid if i didn't you'd never know", ms:1600},
              {f:'me', t:"know what", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"what you mean to me", ms:1200},
              {f:'read', time:'12:33 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:55 PM',
        options:[
          { label:"what did jay's writing make you feel",
            convo:[
              {f:'me', t:"what did jay's writing make you feel"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"seen", ms:1000},
              {f:'me', t:"by what", ms:500},
              {f:'them', t:"he described the way you look at us", ms:1400},
              {f:'them', t:"'like you're memorizing something you're afraid to lose'", ms:1000},
              {f:'me', t:"i do that?", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i do it too. with you.", ms:1200},
              {f:'read', time:'11:59 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"i think jay sees us more clearly than we see ourselves",
            convo:[
              {f:'me', t:"i think jay sees us more clearly than we see ourselves"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah. that's why it scared me.", ms:1200},
              {f:'me', t:"the writing?", ms:500},
              {f:'them', t:"how accurate it was", ms:1400},
              {f:'me', t:"the part about you?", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"the part about you and me", ms:1200},
              {f:'me', t:"what did he write", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"that we orbit each other. without meaning to.", ms:1400},
              {f:'read', time:'11:59 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    22: {
      KAIN: { time:'11:28 PM',
        options:[
          { label:"finn spoke first tonight",
            convo:[
              {f:'me', t:"finn spoke first tonight"},
              {f:'them', t:"i noticed", ms:1400},
              {f:'me', t:"is that significant", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"finn doesn't speak first unless something matters to him", ms:1600},
              {f:'me', t:"what does it mean that it was about me", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"it means you got through to him", ms:1200},
              {f:'them', t:"not many people do", ms:600},
              {f:'me', t:"have you?", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"enough. not all the way.", ms:1000},
              {f:'read', time:'11:32 PM'}
            ], fx:{KAIN_TRUST:1} },
          { label:"you looked surprised when finn said that",
            convo:[
              {f:'me', t:"you looked surprised when finn said that"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i was", ms:900},
              {f:'me', t:"you hide it fast", ms:600},
              {f:'them', t:"it's a habit", ms:1400},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"if you show that something surprised you, people know where to find you", ms:1600},
              {f:'me', t:"is that bad", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"depends who's looking", ms:1000},
              {f:'read', time:'11:32 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:10 PM',
        options:[
          { label:"finn SPOKE tonight. did you hear him",
            convo:[
              {f:'me', t:"finn SPOKE tonight. did you hear him"},
              {f:'them', t:"I HEARD I HEARD", ms:500},
              {f:'them', t:"i've been waiting for him to say something like that for weeks", ms:800},
              {f:'me', t:"why didn't you say anything", ms:700},
              {f:'them', t:"because it wasn't mine to say", ms:1200},
              {f:'me', t:"do you always wait for the right person", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yes. always.", ms:1000},
              {f:'me', t:"even about yourself", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i'm waiting for you to be ready to hear it", ms:1400},
              {f:'read', time:'11:14 PM'}
            ], fx:{THEO_TRUST:3} },
          { label:"what do you do when finn's honest like that",
            convo:[
              {f:'me', t:"what do you do when finn's honest like that"},
              {f:'them', t:"i just let him. don't fill the space.", ms:1400},
              {f:'me', t:"that must be hard for you", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i talk a lot. i know.", ms:1200},
              {f:'me', t:"i like that you talk a lot", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah?", ms:900},
              {f:'me', t:"it means i always know where you are", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"where am i", ms:1000},
              {f:'me', t:"right here", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah. right here.", ms:900},
              {f:'read', time:'11:14 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'11:58 PM',
        options:[
          { label:"you heard finn. what did you think",
            convo:[
              {f:'me', t:"you heard finn. what did you think"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i thought he was braver than me", ms:1400},
              {f:'me', t:"you're brave in other ways", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i write things i can't say", ms:1200},
              {f:'me', t:"finn says things he can't write", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"maybe between us we'd make one whole person", ms:1400},
              {f:'me', t:"you're both whole already", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"with you around maybe", ms:1200},
              {f:'read', time:'12:02 AM'}
            ], fx:{JAY_TRUST:2} },
          { label:"do you ever wish you could speak first like finn",
            convo:[
              {f:'me', t:"do you ever wish you could speak first like finn"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"sometimes", ms:900},
              {f:'me', t:"what would you say", ms:600},
              {f:'them', t:"...", ms:4000},
              {f:'them', t:"that you changed something in me", ms:1400},
              {f:'them', t:"and i don't want it to go back", ms:800},
              {f:'read', time:'12:02 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:04 PM',
        options:[
          { label:"you spoke first tonight. i didn't expect that.",
            convo:[
              {f:'me', t:"you spoke first tonight. i didn't expect that."},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i didn't plan to", ms:1000},
              {f:'me', t:"what made you", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i got tired of waiting for the right moment", ms:1400},
              {f:'me', t:"so this was the moment", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you were there. that was enough.", ms:1200},
              {f:'read', time:'11:08 PM'}
            ], fx:{FINN_TRUST:3} },
          { label:"what made tonight different",
            convo:[
              {f:'me', t:"what made tonight different"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i looked at you and i thought", ms:1200},
              {f:'them', t:"if i don't say it now i might not", ms:800},
              {f:'me', t:"say what", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"that i'm glad you're in this with us", ms:1400},
              {f:'them', t:"that i'm glad you're in this with me", ms:600},
              {f:'read', time:'11:08 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    24: {
      KAIN: { time:'11:02 PM',
        options:[
          { label:"you nailed it today",
            convo:[
              {f:'me', t:"you nailed it today"},
              {f:'them', t:"we nailed it", ms:1400},
              {f:'me', t:"you especially", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i was running on you", ms:1200},
              {f:'me', t:"what do you mean", ms:600},
              {f:'them', t:"every time i felt it slipping i'd find you in the crowd", ms:1600},
              {f:'me', t:"i was in the back", ms:600},
              {f:'them', t:"i know where you are", ms:1400},
              {f:'read', time:'11:06 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"the comeback stage was everything",
            convo:[
              {f:'me', t:"the comeback stage was everything"},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it was", ms:900},
              {f:'me', t:"how do you feel", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"like i can finally breathe", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"come celebrate with us tonight", ms:1200},
              {f:'me', t:"us?", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"with me", ms:900},
              {f:'read', time:'11:06 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'10:48 PM',
        options:[
          { label:"THEO WE DID IT",
            convo:[
              {f:'me', t:"THEO WE DID IT"},
              {f:'them', t:"WE DID IT WE DID IT WE DID IT", ms:400},
              {f:'them', t:"i'm literally shaking right now", ms:500},
              {f:'them', t:"are you shaking?? tell me you're shaking", ms:400},
              {f:'me', t:"i'm shaking", ms:500},
              {f:'them', t:"OKAY GOOD", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i kept looking for you on stage", ms:1400},
              {f:'me', t:"i saw you look", ms:600},
              {f:'them', t:"i just needed to know you were there", ms:1400},
              {f:'read', time:'10:52 PM'}
            ], fx:{THEO_TRUST:2} },
          { label:"how are you feeling right now",
            convo:[
              {f:'me', t:"how are you feeling right now"},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"full", ms:900},
              {f:'me', t:"full?", ms:400},
              {f:'them', t:"like everything good that can happen is happening right now", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"and you're in the middle of it", ms:1200},
              {f:'read', time:'10:52 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'11:18 PM',
        options:[
          { label:"how did it feel from up there",
            convo:[
              {f:'me', t:"how did it feel from up there"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"different from every other time", ms:1400},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i wasn't performing for anyone else", ms:1400},
              {f:'me', t:"then who", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"just you", ms:1000},
              {f:'read', time:'11:22 PM'}
            ], fx:{JAY_TRUST:3} },
          { label:"i watched you the whole time",
            convo:[
              {f:'me', t:"i watched you the whole time"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i know", ms:900},
              {f:'me', t:"could you feel it", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i could", ms:900},
              {f:'me', t:"good", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah", ms:800},
              {f:'read', time:'11:21 PM'}
            ], fx:{JAY_TRUST:2} }
        ]},
      FINN: { time:'11:00 PM',
        options:[
          { label:"tell me you got photos",
            convo:[
              {f:'me', t:"tell me you got photos"},
              {f:'them', t:"i got everything", ms:1400},
              {f:'me', t:"everything?", ms:500},
              {f:'them', t:"every second worth keeping", ms:1200},
              {f:'me', t:"was there a moment you almost missed", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"when you caught my eye and smiled", ms:1400},
              {f:'me', t:"you got that", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i always get that one", ms:1000},
              {f:'read', time:'11:04 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"finn. tonight.",
            convo:[
              {f:'me', t:"finn. tonight."},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i know", ms:900},
              {f:'me', t:"i don't even have the words", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"[photo: all five of you, center stage, light pouring down, mid-laugh]", ms:1200},
              {f:'me', t:"this is everything", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i wanted you to have it", ms:1200},
              {f:'read', time:'11:04 PM'}
            ], fx:{FINN_TRUST:2} }
        ]}
    },
    25: {
      KAIN: { time:'12:10 AM',
        options:[
          { label:"how do you decompress after something like that",
            convo:[
              {f:'me', t:"how do you decompress after something like that"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"usually i don't", ms:1000},
              {f:'me', t:"tonight?", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i want to talk to you for a while", ms:1400},
              {f:'me', t:"about what", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"nothing specific", ms:1000},
              {f:'them', t:"i just want to hear your voice", ms:800},
              {f:'read', time:'12:14 AM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"after the stage. what now",
            convo:[
              {f:'me', t:"after the stage. what now"},
              {f:'them', t:"we keep going", ms:1400},
              {f:'me', t:"and tonight", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"tonight i want to sit somewhere quiet", ms:1400},
              {f:'me', t:"with the group?", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"with you", ms:900},
              {f:'read', time:'12:13 AM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'12:00 AM',
        options:[
          { label:"theo are you crying",
            convo:[
              {f:'me', t:"theo are you crying"},
              {f:'them', t:"no!! maybe!! yes a little!!!", ms:600},
              {f:'me', t:"happy or sad", ms:600},
              {f:'them', t:"happy. so happy. too happy.", ms:800},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"and also a little scared that this was too good", ms:1400},
              {f:'me', t:"scared of what", ms:600},
              {f:'them', t:"that it ends", ms:1200},
              {f:'me', t:"it doesn't have to", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"promise?", ms:900},
              {f:'me', t:"promise", ms:400},
              {f:'read', time:'12:04 AM'}
            ], fx:{THEO_TRUST:3} },
          { label:"what's the best thing about tonight",
            convo:[
              {f:'me', t:"what's the best thing about tonight"},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"that you were there to share it", ms:1400},
              {f:'me', t:"not the performance?", ms:600},
              {f:'them', t:"the performance is better because you were there", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i mean it", ms:900},
              {f:'read', time:'12:03 AM'}
            ], fx:{THEO_TRUST:2} }
        ]},
      JAY: { time:'12:22 AM',
        options:[
          { label:"where did you go after the stage",
            convo:[
              {f:'me', t:"where did you go after the stage"},
              {f:'them', t:"somewhere quiet", ms:1600},
              {f:'me', t:"without telling anyone", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i texted you", ms:1200},
              {f:'me', t:"you texted me to say you were leaving", ms:700},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i knew you'd want to know", ms:1200},
              {f:'me', t:"come back", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"where are you", ms:1000},
              {f:'me', t:"where you left", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"be there in five", ms:900},
              {f:'read', time:'12:26 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"i keep thinking about what you said on stage",
            convo:[
              {f:'me', t:"i keep thinking about what you said on stage"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i didn't know i was going to say it", ms:1400},
              {f:'me', t:"it came out anyway", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"some things do that", ms:1000},
              {f:'me', t:"what things", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"things that are true enough to break through", ms:1400},
              {f:'read', time:'12:25 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:50 PM',
        options:[
          { label:"show me your favorite photo from tonight",
            convo:[
              {f:'me', t:"show me your favorite photo from tonight"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"[photo: you, right after it ended, eyes still bright, not yet back to normal]", ms:1200},
              {f:'me', t:"that's your favorite", ms:600},
              {f:'them', t:"you were still in it", ms:1400},
              {f:'me', t:"in what", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"the feeling", ms:1000},
              {f:'them', t:"i love catching people still in the feeling", ms:800},
              {f:'read', time:'11:54 PM'}
            ], fx:{FINN_TRUST:3} },
          { label:"tonight felt like something shifted",
            convo:[
              {f:'me', t:"tonight felt like something shifted"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"for me too", ms:1000},
              {f:'me', t:"what shifted", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i stopped pretending i don't feel things", ms:1400},
              {f:'me', t:"about what", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"about you", ms:900},
              {f:'read', time:'11:54 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    27: {
      KAIN: { time:'11:08 PM',
        options:[
          { label:"all five of us tonight. that doesn't happen often.",
            convo:[
              {f:'me', t:"all five of us tonight. that doesn't happen often."},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"no", ms:800},
              {f:'me', t:"how are you with it", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"better than i thought i'd be", ms:1200},
              {f:'me', t:"why better", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you were there", ms:1000},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"you make it easier to be in a room full of people", ms:1400},
              {f:'read', time:'11:12 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"what did you think of tonight",
            convo:[
              {f:'me', t:"what did you think of tonight"},
              {f:'them', t:"which part", ms:1400},
              {f:'me', t:"all of it", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i thought it was the best version of us", ms:1400},
              {f:'me', t:"because of the five of us together?", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"because of you being in it", ms:1200},
              {f:'read', time:'11:12 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'10:55 PM',
        options:[
          { label:"tonight was the best night",
            convo:[
              {f:'me', t:"tonight was the best night"},
              {f:'them', t:"RIGHT", ms:400},
              {f:'them', t:"all five of us actually together", ms:600},
              {f:'them', t:"nobody fighting nobody disappearing", ms:500},
              {f:'me', t:"rare", ms:500},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i've been waiting for a night like this", ms:1400},
              {f:'me', t:"for how long", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"since before you got here", ms:1200},
              {f:'them', t:"you're what made it possible", ms:800},
              {f:'read', time:'10:59 PM'}
            ], fx:{THEO_TRUST:3} },
          { label:"i don't want tonight to end",
            convo:[
              {f:'me', t:"i don't want tonight to end"},
              {f:'them', t:"me neither", ms:1200},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"can i tell you something", ms:1200},
              {f:'me', t:"always", ms:400},
              {f:'them', t:"i feel most like myself when we're all together", ms:1400},
              {f:'them', t:"and most like myself when i'm talking just to you", ms:800},
              {f:'me', t:"those are different things", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah. both true.", ms:900},
              {f:'read', time:'10:59 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'11:30 PM',
        options:[
          { label:"you were actually part of the group tonight",
            convo:[
              {f:'me', t:"you were actually part of the group tonight"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"was i not before", ms:1200},
              {f:'me', t:"you were in the room. not always in it.", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"tonight felt different", ms:1200},
              {f:'me', t:"what changed", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i stopped watching from outside", ms:1400},
              {f:'me', t:"what made you", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"you kept pulling me back in", ms:1200},
              {f:'read', time:'11:34 PM'}
            ], fx:{JAY_TRUST:2} },
          { label:"you smiled tonight. actually smiled.",
            convo:[
              {f:'me', t:"you smiled tonight. actually smiled."},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i do that sometimes", ms:1000},
              {f:'me', t:"not like that", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"it was your fault", ms:1200},
              {f:'me', t:"i'll take it", ms:500},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"yeah. you can keep it.", ms:1000},
              {f:'read', time:'11:34 PM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:14 PM',
        options:[
          { label:"all five of us. did you get it",
            convo:[
              {f:'me', t:"all five of us. did you get it"},
              {f:'them', t:"every angle", ms:1400},
              {f:'me', t:"show me one", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"[photo: all five, different directions, all laughing, nothing posed]", ms:1200},
              {f:'me', t:"this is the one", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i know", ms:900},
              {f:'me', t:"print it for all of us", ms:600},
              {f:'them', t:"i already did", ms:1200},
              {f:'read', time:'11:18 PM'}
            ], fx:{FINN_TRUST:2} },
          { label:"what did tonight mean to you",
            convo:[
              {f:'me', t:"what did tonight mean to you"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"it means i have something worth keeping", ms:1400},
              {f:'me', t:"the photos?", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"all of it", ms:900},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"you especially", ms:1200},
              {f:'read', time:'11:18 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    28: {
      KAIN: { time:'11:20 PM',
        options:[
          { label:"finn kept something from the beginning",
            convo:[
              {f:'me', t:"finn kept something from the beginning"},
              {f:'them', t:"i know", ms:1400},
              {f:'me', t:"did you know what it was", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i suspected", ms:1000},
              {f:'me', t:"why didn't you say anything", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"it wasn't mine to say", ms:1200},
              {f:'me', t:"you protect him", ms:600},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"i protect all of you", ms:1200},
              {f:'me', t:"even me", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"especially you", ms:1000},
              {f:'read', time:'11:24 PM'}
            ], fx:{KAIN_TRUST:2} },
          { label:"are you okay with what finn shared",
            convo:[
              {f:'me', t:"are you okay with what finn shared"},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it's a lot to take in", ms:1200},
              {f:'me', t:"yeah", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i'm glad he kept it", ms:1200},
              {f:'me', t:"why", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it means something was worth keeping", ms:1400},
              {f:'me', t:"what was", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"the beginning. when everything was still possible.", ms:1400},
              {f:'read', time:'11:24 PM'}
            ], fx:{KAIN_TRUST:2} }
        ]},
      THEO: { time:'11:04 PM',
        options:[
          { label:"finn really kept all of that",
            convo:[
              {f:'me', t:"finn really kept all of that"},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"i knew he kept things. i didn't know how much.", ms:1400},
              {f:'me', t:"does it change how you see him", ms:700},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it makes me see him more clearly", ms:1400},
              {f:'me', t:"same", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"do you think he knew we'd find out someday", ms:1400},
              {f:'me', t:"i think he hoped we would", ms:700},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"yeah. me too.", ms:900},
              {f:'read', time:'11:08 PM'}
            ], fx:{THEO_TRUST:1} },
          { label:"what do you keep that no one knows about",
            convo:[
              {f:'me', t:"what do you keep that no one knows about"},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"how scared i am sometimes", ms:1200},
              {f:'me', t:"of what", ms:500},
              {f:'them', t:"not being enough", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"don't say i am enough", ms:1000},
              {f:'me', t:"i wasn't going to", ms:600},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"oh", ms:700},
              {f:'me', t:"i was going to say you're more than you think", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"okay. that's better.", ms:1000},
              {f:'read', time:'11:08 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:02 AM',
        options:[
          { label:"finn and i are more similar than i thought",
            convo:[
              {f:'me', t:"finn and i are more similar than i thought"},
              {f:'them', t:"how so", ms:1400},
              {f:'me', t:"we keep things that matter to us quietly", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i keep things too", ms:1200},
              {f:'me', t:"i know", ms:500},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"the difference is finn's keeping started before you", ms:1400},
              {f:'me', t:"and yours", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"mine started because of you", ms:1200},
              {f:'read', time:'12:06 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"what would you keep if this ended tomorrow",
            convo:[
              {f:'me', t:"what would you keep if this ended tomorrow"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"everything you said to me", ms:1200},
              {f:'me', t:"just that", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"the way it felt to be known by you", ms:1400},
              {f:'read', time:'12:06 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'10:58 PM',
        options:[
          { label:"i didn't know you kept all of that",
            convo:[
              {f:'me', t:"i didn't know you kept all of that"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i keep everything that matters", ms:1200},
              {f:'me', t:"why didn't you say", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"some things are better kept until the right time", ms:1400},
              {f:'me', t:"and now is the right time", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"i think you were always going to be the right time", ms:1400},
              {f:'read', time:'11:02 PM'}
            ], fx:{FINN_TRUST:3} },
          { label:"the first photo you ever took of me",
            convo:[
              {f:'me', t:"the first photo you ever took of me"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"[photo: day one. you by the window. not looking at the camera. completely yourself.]", ms:1200},
              {f:'me', t:"i didn't know you took this", ms:700},
              {f:'them', t:"you weren't supposed to", ms:1200},
              {f:'me', t:"you kept it all this time", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"it was the first thing i kept because of you", ms:1400},
              {f:'them', t:"it won't be the last", ms:600},
              {f:'read', time:'11:02 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    },
    30: {
      KAIN: { time:'11:55 PM',
        options:[
          { label:"we made it",
            convo:[
              {f:'me', t:"we made it"},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"yeah", ms:800},
              {f:'me', t:"you okay?", ms:500},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i keep going back to the beginning", ms:1400},
              {f:'me', t:"thinking about what", ms:600},
              {f:'them', t:"who you were on the first day", ms:1200},
              {f:'them', t:"who you are now", ms:600},
              {f:'me', t:"different?", ms:500},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"more you. that's the only way to say it.", ms:1400},
              {f:'me', t:"kain", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"stay", ms:900},
              {f:'read', time:'11:59 PM'}
            ], fx:{KAIN_TRUST:3} },
          { label:"what comes after calix",
            convo:[
              {f:'me', t:"what comes after calix"},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"whatever we make", ms:1200},
              {f:'me', t:"we?", ms:400},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"you. me. all of it.", ms:1200},
              {f:'me', t:"that's not an answer", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"it's the only one i have right now", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"is that enough", ms:900},
              {f:'me', t:"it's enough", ms:500},
              {f:'read', time:'11:59 PM'}
            ], fx:{KAIN_TRUST:3} }
        ]},
      THEO: { time:'11:40 PM',
        options:[
          { label:"theo. we did it. CALIX.",
            convo:[
              {f:'me', t:"theo. we did it. CALIX."},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"okay i am definitely crying right now", ms:1000},
              {f:'me', t:"me too a little", ms:600},
              {f:'them', t:"good. we can cry together.", ms:1000},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"can i tell you something?", ms:1200},
              {f:'me', t:"always", ms:400},
              {f:'them', t:"you were the missing piece", ms:1400},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"i mean it. everything clicked when you arrived.", ms:1200},
              {f:'them', t:"...", ms:2000},
              {f:'them', t:"don't ever disappear on me okay", ms:1200},
              {f:'me', t:"i won't", ms:400},
              {f:'them', t:"...", ms:2200},
              {f:'them', t:"okay. good. CALIX!!!", ms:800},
              {f:'read', time:'11:44 PM'}
            ], fx:{THEO_TRUST:3} },
          { label:"what does the name mean to you now",
            convo:[
              {f:'me', t:"what does the name mean to you now"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"it means us", ms:1000},
              {f:'me', t:"all five", ms:500},
              {f:'them', t:"all five. but also", ms:1200},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"it means the version of me that only exists with you", ms:1600},
              {f:'me', t:"theo", ms:400},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"the best version", ms:1000},
              {f:'read', time:'11:43 PM'}
            ], fx:{THEO_TRUST:3} }
        ]},
      JAY: { time:'12:18 AM',
        options:[
          { label:"calix. what do you think",
            convo:[
              {f:'me', t:"calix. what do you think"},
              {f:'them', t:"...", ms:3800},
              {f:'them', t:"i think we built something real", ms:1400},
              {f:'me', t:"you and the group", ms:600},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"you and me", ms:1000},
              {f:'me', t:"jay", ms:400},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"i started writing again because of you", ms:1400},
              {f:'them', t:"i wanted you to know that", ms:600},
              {f:'read', time:'12:22 AM'}
            ], fx:{JAY_TRUST:3} },
          { label:"write me something. one last thing.",
            convo:[
              {f:'me', t:"write me something. one last thing."},
              {f:'them', t:"...", ms:4200},
              {f:'them', t:"'i didn't think this would happen'", ms:1400},
              {f:'me', t:"what would happen", ms:600},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"'finding you here'", ms:1200},
              {f:'them', t:"'and not wanting to leave'", ms:600},
              {f:'me', t:"jay", ms:400},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"don't go", ms:1000},
              {f:'read', time:'12:22 AM'}
            ], fx:{JAY_TRUST:3} }
        ]},
      FINN: { time:'11:48 PM',
        options:[
          { label:"what photo are you taking tonight",
            convo:[
              {f:'me', t:"what photo are you taking tonight"},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i'm not", ms:900},
              {f:'me', t:"finn. you always have the camera.", ms:700},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"tonight i want to just be in it", ms:1400},
              {f:'me', t:"not behind the lens?", ms:600},
              {f:'them', t:"...", ms:2600},
              {f:'them', t:"not tonight", ms:900},
              {f:'me', t:"what changed", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"i don't want to miss you trying to capture you", ms:1400},
              {f:'read', time:'11:52 PM'}
            ], fx:{FINN_TRUST:3} },
          { label:"finn. this is it.",
            convo:[
              {f:'me', t:"finn. this is it."},
              {f:'them', t:"...", ms:3400},
              {f:'them', t:"yeah", ms:900},
              {f:'me', t:"how do you feel", ms:600},
              {f:'them', t:"...", ms:3200},
              {f:'them', t:"like everything i kept was worth keeping", ms:1400},
              {f:'me', t:"even the hard parts", ms:600},
              {f:'them', t:"...", ms:2800},
              {f:'them', t:"especially the hard parts", ms:1200},
              {f:'them', t:"...", ms:2400},
              {f:'them', t:"thank you for being here", ms:1200},
              {f:'me', t:"i wouldn't be anywhere else", ms:700},
              {f:'them', t:"...", ms:3000},
              {f:'them', t:"i know. that's everything.", ms:1200},
              {f:'read', time:'11:52 PM'}
            ], fx:{FINN_TRUST:3} }
        ]}
    }
  };

  function showTextMoment(ep) {
    var ov = document.getElementById('txt-overlay');
    var whoDiv = document.getElementById('txt-who');
    var phoneDiv = document.getElementById('txt-phone');
    if (!ov) return;
    whoDiv.style.display = 'flex';
    phoneDiv.style.display = 'none';
    var grid = document.getElementById('txt-who-grid');
    grid.innerHTML = '';
    var members = ['KAIN','THEO','JAY','FINN'];
    var names = { KAIN:'Kain', THEO:'Theo', JAY:'Jay', FINN:'Finn' };
    members.forEach(function(m) {
      var btn = document.createElement('button');
      btn.className = 'txt-who-btn';
      var av = document.createElement('span');
      av.className = 'txt-who-avatar';
      av.style.background = MEMBER_COLORS[m];
      av.textContent = MEMBER_INITIALS[m];
      btn.appendChild(av);
      btn.appendChild(document.createTextNode(names[m]));
      btn.onclick = function() { startTextConvo(ep, m); };
      grid.appendChild(btn);
    });
    ov.classList.add('show');
  }

  function startTextConvo(ep, member) {
    var data = TEXT_MOMENTS[ep] && TEXT_MOMENTS[ep][member];
    if (!data) return;
    lastTxtMember = member;  // remember who was texted for the gift screen
    var whoDiv = document.getElementById('txt-who');
    var phoneDiv = document.getElementById('txt-phone');
    var names = { KAIN:'Kain', THEO:'Theo', JAY:'Jay', FINN:'Finn' };
    whoDiv.style.display = 'none';
    phoneDiv.style.display = 'flex';
    document.getElementById('txt-status-time').textContent = data.time;
    var av = document.getElementById('txt-header-avatar');
    av.textContent = MEMBER_INITIALS[member];
    av.style.background = MEMBER_COLORS[member];
    document.getElementById('txt-header-name').textContent = names[member];
    var msgs = document.getElementById('txt-messages');
    msgs.innerHTML = '';
    var bottom = document.getElementById('txt-bottom');
    bottom.innerHTML = '';
    // show draft options as chat bubbles
    var draftArea = document.createElement('div');
    draftArea.className = 'txt-draft-area';
    var lbl = document.createElement('p');
    lbl.className = 'txt-draft-label';
    lbl.textContent = 'What do you want to text?';
    draftArea.appendChild(lbl);
    data.options.forEach(function(opt, i) {
      var wrap = document.createElement('div');
      wrap.className = 'txt-draft-bubble-wrap';
      var bubble = document.createElement('button');
      bubble.className = 'txt-draft-bubble';
      bubble.textContent = opt.label;
      bubble.onclick = function() {
        draftArea.remove();
        playTextConvo(opt, member, msgs, bottom);
      };
      wrap.appendChild(bubble);
      draftArea.appendChild(wrap);
    });
    bottom.appendChild(draftArea);
  }

  function playTextConvo(opt, member, msgs, bottom) {
    var beats = opt.convo;
    var delay = 400;
    beats.forEach(function(beat) {
      if (beat.f === 'read') {
        delay += 1000;
        (function(d, b) {
          setTimeout(function() {
            var r = document.createElement('p');
            r.className = 'txt-read';
            r.textContent = 'read ' + b.time;
            msgs.appendChild(r);
            msgs.scrollTop = msgs.scrollHeight;
            // show continue after read
            setTimeout(function() {
              applyDeltas(opt.fx);
              var trustLabel = Object.keys(opt.fx || {}).map(function(k) {
                var v = opt.fx[k];
                var lbl = {KAIN_TRUST:'Kain',THEO_TRUST:'Theo',JAY_TRUST:'Jay',FINN_TRUST:'Finn'}[k] || k;
                return (v > 0 ? '+' : '') + v + ' ' + lbl;
              }).join('  ');
              bottom.innerHTML =
                (trustLabel ? '<p class="txt-trust-pill">' + trustLabel + '</p>' : '') +
                '<button class="txt-continue-btn" onclick="closeTxtOverlay()">continue →</button>';
            }, 800);
          }, d);
        })(delay, beat);
        return;
      }
      delay += (beat.ms || 700);
      (function(d, b) {
        setTimeout(function() {
          var isMe = b.f === 'me';
          var wrap = document.createElement('div');
          wrap.className = 'txt-bubble-wrap ' + (isMe ? 'me' : 'them');

          // Avatar
          var av = document.createElement('img');
          av.className = 'txt-avatar';
          var AVATAR_FILES = {
            ALEX: 'Alex_Avatar.png', YOOJIN: 'Yoojin_avatar.png', GREY: 'Grey_Avatar.png',
            KAIN: 'Kain_Avatar.png', THEO: 'Theo_avatar.png', JAY: 'Jay_Avatar.png', FINN: 'Finn_Avatar.png'
          };
          if (isMe) {
            var cname = (gameState.candidateName || 'ALEX');
            av.src = 'Images/10_Avatar/' + (AVATAR_FILES[cname] || 'Alex_Avatar.png');
            av.alt = cname;
          } else {
            av.src = 'Images/10_Avatar/' + (AVATAR_FILES[member] || 'Kain_Avatar.png');
            av.alt = member;
          }

          var bubble = document.createElement('div');
          bubble.className = 'txt-bubble';
          bubble.textContent = b.t;

          if (isMe) {
            wrap.appendChild(bubble);
            wrap.appendChild(av);
          } else {
            wrap.appendChild(av);
            wrap.appendChild(bubble);
          }
          msgs.appendChild(wrap);
          msgs.scrollTop = msgs.scrollHeight;
        }, d);
      })(delay, beat);
      delay += 200;
    });
  }

  window.showTextMoment = showTextMoment;
  window.closeTxtOverlay = function() {
    var ov = document.getElementById('txt-overlay');
    if (ov) ov.classList.remove('show');
    if (!giftShownThisEpisode && shouldOfferGiftScreen()) {
      giftShownThisEpisode = true;
      openGiftScreen();
    } else {
      finishEpisodeFlow();
    }
  };
  // ── END TEXT MOMENT ─────────────────────────────────────────────

  function shouldOfferGiftScreen() {
    return true;
  }

  // ── SPECIAL EPISODE SYSTEM ──────────────────────────────────────────

  var SPECIAL_EP_CONFIG = {
    10: { title: 'The Long Drive', subtitle: 'A day off. The road to Incheon. Choose who you spend it with.', reward: 200 },
    20: { title: 'Seongsu', subtitle: 'A free afternoon. Seongsu-dong. Choose who you spend it with.', reward: 300 }
  };

  var _specialEpSegments = [];
  var _specialEpIdx = 0;
  var _specialEpInOption = false;
  var _specialEpOptionLines = [];

  function finishEpisodeFlow() {
    if (checkAndShowSpecialEpisodeUnlock()) return;
    if (typeof go === 'function') go(6);
    if (typeof window.initReward === 'function') window.initReward();
  }

  // Trust required to unlock each special episode (any single member must reach this)
  var SPECIAL_EP_TRUST_REQ = { 10: 5, 20: 10 };

  function checkAndShowSpecialEpisodeUnlock() {
    var ep = Number(gameState.currentEpisodeN || 0);
    var trustReq = SPECIAL_EP_TRUST_REQ[ep];
    if (!trustReq) return false;
    var unlockKey = 'calix_special_ep' + ep + '_unlocked';
    if (localStorage.getItem(unlockKey)) return false;
    var trustKeys = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST'];
    var meetsReq = trustKeys.some(function (k) { return (gameState.stats[k] || 0) >= trustReq; });
    if (!meetsReq) return false;
    showSpecialEpisodeMemberPicker(ep);
    return true;
  }

  function showSpecialEpisodeMemberPicker(ep) {
    var cfg = SPECIAL_EP_CONFIG[ep] || {};
    var ov = document.getElementById('special-ep-unlock-overlay');
    if (!ov) return;
    var titleEl = document.getElementById('special-ep-unlock-ep-title');
    var subEl = document.getElementById('special-ep-unlock-subtitle');
    var costEl = document.getElementById('special-ep-unlock-cost');
    if (titleEl) titleEl.textContent = cfg.title || ('Special Episode ' + ep);
    if (subEl) subEl.textContent = cfg.subtitle || '';
    if (costEl) costEl.textContent = '✨ Unlocked through trust';
    ov.setAttribute('data-ep', String(ep));
    ov.classList.add('show');
    ov.setAttribute('aria-hidden', 'false');
  }

  window.pickSpecialEpisodeMember = function (member) {
    var ov = document.getElementById('special-ep-unlock-overlay');
    if (!ov) return;
    var ep = parseInt(ov.getAttribute('data-ep'), 10);
    ov.classList.remove('show');
    ov.setAttribute('aria-hidden', 'true');
    // No coin deduction — trust-based unlock is free
    localStorage.setItem('calix_special_ep' + ep + '_unlocked', '1');
    gameState._specialEpPendingReward = (SPECIAL_EP_CONFIG[ep] || {}).reward || 0;
    try { saveGame(); } catch (e) { /* ignore */ }
    launchSpecialEpisode(ep, member.toLowerCase());
  };

  window.skipSpecialEpisodeUnlock = function () {
    var ov = document.getElementById('special-ep-unlock-overlay');
    if (ov) { ov.classList.remove('show'); ov.setAttribute('aria-hidden', 'true'); }
    if (typeof go === 'function') go(6);
    if (typeof window.initReward === 'function') window.initReward();
  };

  function launchSpecialEpisode(ep, memberLower) {
    var epStr = ep < 10 ? '0' + ep : String(ep);
    var fname = 'Context/scripts/ep_bonus' + epStr + '_' + memberLower + '.md';
    var reader = document.getElementById('special-ep-reader');
    var body = document.getElementById('special-ep-reader-body');
    if (body) body.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding-top:60px;font-style:italic;">Loading…</p>';
    if (reader) { reader.classList.add('show'); reader.setAttribute('aria-hidden', 'false'); }
    initSpecialEpStars();
    fetch(fname)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (md) {
        var cfg = SPECIAL_EP_CONFIG[ep] || {};
        var labelEl = document.getElementById('special-ep-reader-label');
        if (labelEl) labelEl.textContent = cfg.title || 'Special Episode';
        _specialEpSegments = parseSpecialEpisodeMd(md);
        _specialEpIdx = 0;
        _specialEpInOption = false;
        renderSpecialEpCurrent();
      })
      .catch(function (e) {
        console.error('Special episode load failed', fname, e);
        if (reader) { reader.classList.remove('show'); reader.setAttribute('aria-hidden', 'true'); }
        if (typeof go === 'function') go(6);
        if (typeof window.initReward === 'function') window.initReward();
      });
  }

  function parseSpecialEpisodeMd(md) {
    var segments = [];
    var lines = md.split('\n');
    var i = 0;
    while (i < lines.length) {
      var trimmed = lines[i].trim();
      if (/^##\s/.test(trimmed)) {
        var title = trimmed.replace(/^##\s+/, '');
        var sectionLines = [];
        i++;
        while (i < lines.length && !/^##\s/.test(lines[i].trim())) {
          sectionLines.push(lines[i]);
          i++;
        }
        if (/^SCENE DIRECTION NOTES/.test(title)) {
          // skip director notes
        } else if (/^CHOICE\s+\d+/i.test(title)) {
          var opts = parseSpecialEpOptions(sectionLines);
          if (opts.length >= 2) segments.push({ type: 'choice', title: title, options: opts });
        } else {
          segments.push({ type: 'scene', title: title, lines: sectionLines });
        }
      } else {
        i++;
      }
    }
    return segments;
  }

  function parseSpecialEpOptions(lines) {
    var options = [];
    var currentLabel = null;
    var currentLines = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (/^\*\*OPTION\s+[AB]\*\*:/i.test(t)) {
        if (currentLabel !== null) {
          options.push({ label: currentLabel, lines: currentLines.slice() });
          currentLines = [];
        }
        currentLabel = t.replace(/^\*\*OPTION\s+[AB]\*\*:\s*/i, '').replace(/^\*+|\*+$/g, '').replace(/^"+|"+$/g, '').trim();
      } else if (currentLabel !== null) {
        if (/^---+$/.test(t) && currentLines.filter(function (l) { return l.trim(); }).length === 0) continue;
        currentLines.push(lines[i]);
      }
    }
    if (currentLabel !== null && currentLines.length) {
      options.push({ label: currentLabel, lines: currentLines.slice() });
    }
    return options;
  }

  function renderSpecialEpLines(lines) {
    var html = '';
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function clean(s) {
      // strip outer double-quotes and asterisks
      return s.replace(/^["]+|["]+$/g, '').replace(/^\*+|\*+$/g, '').trim();
    }
    function mName(k) {
      return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
    }
    function emitDialogue(name, text) {
      if (!text) return;
      if (name === 'YOU') {
        html += '<p class="sep-you">' + esc(text) + '</p>';
      } else {
        html += '<div class="sep-them"><span class="sep-them-name">' + esc(mName(name)) + '</span><span class="sep-them-text">' + esc(text) + '</span></div>';
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t || /^-{3,}$/.test(t)) continue;

      // ── Blockquote lines (start with >) ──────────────────────
      if (t.charAt(0) === '>') {
        var bInner = t.replace(/^>\s*/, '');
        // > **NAME:** dialogue
        var bm = bInner.match(/^\*\*([A-Z]+)\*\*:?\s*(.*)/);
        if (bm) {
          var bName = bm[1], bText = clean(bm[2]);
          if (bName !== 'NARRATION') emitDialogue(bName, bText);
        } else if (bInner.trim()) {
          // > *narration* or > plain text
          var bNarr = bInner.replace(/^\*+|\*+$/g, '').trim();
          if (bNarr) html += '<p class="sep-narr">' + esc(bNarr) + '</p>';
        }
        continue;
      }

      // ── Top-level **NAME:** dialogue ──────────────────────────
      var dm = t.match(/^\*\*([A-Z]+)\*\*:?\s*(.*)/);
      if (dm) {
        var dName = dm[1], dText = clean(dm[2]);
        if (dName !== 'NARRATION') emitDialogue(dName, dText);
        continue;
      }

      // ── *stage direction* (single asterisk wrap) ──────────────
      if (t.charAt(0) === '*' && t.charAt(1) !== '*') {
        var narr = t.replace(/^\*+|\*+$/g, '').trim();
        if (narr) html += '<p class="sep-narr">' + esc(narr) + '</p>';
        continue;
      }

      // ── Anything else that isn't a markdown header ────────────
      if (!t.startsWith('#') && !/^\*\*.*\*\*$/.test(t)) {
        html += '<p class="sep-narr">' + esc(t) + '</p>';
      }
    }
    return html;
  }

  function initSpecialEpStars() {
    var el = document.getElementById('special-ep-stars');
    if (!el || el.childElementCount > 0) return;
    for (var i = 0; i < 28; i++) {
      var s = document.createElement('span');
      s.className = 'sep-star';
      s.textContent = Math.random() > 0.5 ? '✦' : '✧';
      s.style.left = (Math.random() * 100) + '%';
      s.style.fontSize = (5 + Math.random() * 9) + 'px';
      s.style.animationDuration = (5 + Math.random() * 10) + 's';
      s.style.animationDelay = (-Math.random() * 14) + 's';
      s.style.opacity = (0.15 + Math.random() * 0.4);
      el.appendChild(s);
    }
  }

  function renderSpecialEpCurrent() {
    var body = document.getElementById('special-ep-reader-body');
    var choicesDiv = document.getElementById('special-ep-choices');
    var continueBtn = document.getElementById('special-ep-continue');
    if (!body) return;

    if (_specialEpIdx >= _specialEpSegments.length) {
      // End screen
      var reward = gameState._specialEpPendingReward || 0;
      if (reward) {
        gameState.stats.COINS = (gameState.stats.COINS || 0) + reward;
        gameState._specialEpPendingReward = 0;
        try { saveGame(); } catch (e) { /* ignore */ }
      }
      body.innerHTML = '<div class="special-ep-end-screen">' +
        '<p class="sep-narr" style="font-size:22px;margin-bottom:12px">✦</p>' +
        '<h3>— End of Special Episode —</h3>' +
        (reward ? '<p class="sep-narr">+' + reward + ' coins earned</p>' : '') +
        '<button class="special-ep-end-btn" onclick="window.closeSpecialEpReader()">Continue</button>' +
        '</div>';
      if (choicesDiv) choicesDiv.style.display = 'none';
      if (continueBtn) continueBtn.style.display = 'none';
      body.scrollTop = 0;
      return;
    }

    var seg = _specialEpSegments[_specialEpIdx];

    if (_specialEpInOption) {
      var optHtml = renderSpecialEpLines(_specialEpOptionLines);
      body.innerHTML = optHtml || '<p class="sep-narr">…</p>';
      body.scrollTop = 0;
      if (choicesDiv) choicesDiv.style.display = 'none';
      if (continueBtn) {
        continueBtn.style.display = 'block';
        continueBtn.textContent = 'continue';
        continueBtn.onclick = function () {
          _specialEpInOption = false;
          _specialEpIdx++;
          renderSpecialEpCurrent();
        };
      }
      return;
    }

    if (seg.type === 'scene') {
      var sceneHtml = renderSpecialEpLines(seg.lines);
      if (!sceneHtml.trim()) {
        _specialEpIdx++;
        renderSpecialEpCurrent();
        return;
      }
      body.innerHTML = sceneHtml;
      body.scrollTop = 0;
      if (choicesDiv) choicesDiv.style.display = 'none';
      if (continueBtn) {
        continueBtn.style.display = 'block';
        continueBtn.textContent = 'continue';
        continueBtn.onclick = function () {
          _specialEpIdx++;
          renderSpecialEpCurrent();
        };
      }
    } else if (seg.type === 'choice') {
      body.innerHTML = '';
      body.scrollTop = 0;
      if (choicesDiv) {
        choicesDiv.style.display = 'flex';
        choicesDiv.innerHTML = '';
        seg.options.forEach(function (opt) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'special-ep-choice-btn';
          btn.textContent = opt.label;
          btn.onclick = (function (o) {
            return function () {
              _specialEpInOption = true;
              _specialEpOptionLines = o.lines;
              renderSpecialEpCurrent();
            };
          })(opt);
          choicesDiv.appendChild(btn);
        });
      }
      if (continueBtn) continueBtn.style.display = 'none';
    }
  }

  window.closeSpecialEpReader = function () {
    var reader = document.getElementById('special-ep-reader');
    if (reader) { reader.classList.remove('show'); reader.setAttribute('aria-hidden', 'true'); }
    if (typeof go === 'function') go(6);
    if (typeof window.initReward === 'function') window.initReward();
  };

  // ── END SPECIAL EPISODE SYSTEM ──────────────────────────────────────

  function giftCurrentCost() {
    if (!giftPickType) return 0;
    return GIFT_MEANINGFUL_KEYS.indexOf(giftPickType) !== -1 ? GIFT_COST_MEANINGFUL : GIFT_COST_SMALL;
  }

  function updateGiftConfirmState() {
    var btn = document.getElementById('gift-btn-confirm');
    var err = document.getElementById('gift-insufficient');
    var cost = giftCurrentCost();
    var coins = gameState.stats.COINS || 0;
    var canAfford = cost > 0 && coins >= cost;
    var ready = !!(giftPickMember && giftPickType);
    if (btn) {
      btn.disabled = !ready || !canAfford;
      btn.textContent = ready ? 'Send gift — ' + cost + ' coins' : 'Send gift';
    }
    if (err) {
      if (ready && !canAfford) err.classList.add('show');
      else err.classList.remove('show');
    }
    // dim opts player can't afford
    document.querySelectorAll('.gift-opt').forEach(function(el) {
      var c = parseInt(el.getAttribute('data-cost') || '0', 10);
      el.classList.toggle('gift-opt--cant-afford', c > coins);
    });
  }

  function refreshGiftMemberCells() {
    var last = gameState.lastGiftMember;
    document.querySelectorAll('.gift-member-cell').forEach(function (el) {
      var m = el.getAttribute('data-member');
      var blocked = m === last;
      el.disabled = blocked;
      el.classList.toggle('gift-member--blocked', blocked);
      if (blocked && giftPickMember === m) {
        giftPickMember = null;
        el.classList.remove('gift-member--selected');
      }
    });
    updateGiftConfirmState();
  }

  function resetGiftPickerUi() {
    giftPickMember = null;
    giftPickType = null;
    document.querySelectorAll('.gift-member-cell').forEach(function (el) {
      el.classList.remove('gift-member--selected');
    });
    document.querySelectorAll('.gift-opt').forEach(function (el) {
      el.classList.remove('gift-opt--selected');
    });
    updateGiftConfirmState();
  }

  function showGiftThanks(memberKey, giftKey) {
    var nameEl = document.getElementById('gift-msg-name');
    var bodyEl = document.getElementById('gift-msg-body');
    var pick = document.getElementById('gift-phase-select');
    var thx = document.getElementById('gift-phase-thanks');
    if (nameEl) nameEl.textContent = GIFT_MEMBER_LABEL[memberKey] || memberKey;
    var row = GIFT_THANK_YOU[memberKey];
    var lines = row && row[giftKey];
    var line = Array.isArray(lines) ? lines[Math.floor(Math.random() * lines.length)] : (lines || '');
    if (bodyEl) bodyEl.textContent = line;
    if (pick) pick.classList.add('gift-phase--hidden');
    if (thx) thx.classList.remove('gift-phase--hidden');
  }

  function hideGiftOverlay() {
    var ov = document.getElementById('gift-overlay');
    if (ov) {
      ov.classList.remove('show');
      ov.setAttribute('aria-hidden', 'true');
    }
    var pick = document.getElementById('gift-phase-select');
    var thx = document.getElementById('gift-phase-thanks');
    if (thx) thx.classList.add('gift-phase--hidden');
    if (pick) pick.classList.remove('gift-phase--hidden');
    resetGiftPickerUi();
  }

  function refreshGiftUnlockTeaser() {
    var teaser = document.getElementById('gift-unlock-teaser');
    if (!teaser) return;
    // Find the next special episode that hasn't been unlocked yet
    var targetEp = null, targetTrustReq = null;
    var epKeys = Object.keys(SPECIAL_EP_TRUST_REQ).map(Number).sort(function(a,b){return a-b;});
    for (var i = 0; i < epKeys.length; i++) {
      var k = epKeys[i];
      if (!localStorage.getItem('calix_special_ep' + k + '_unlocked')) {
        targetEp = k; targetTrustReq = SPECIAL_EP_TRUST_REQ[k]; break;
      }
    }
    if (!targetEp) { teaser.classList.remove('active'); return; }
    teaser.classList.add('active');
    var titleEl = document.getElementById('gift-unlock-title');
    var subEl = document.getElementById('gift-unlock-sub');
    var fillEl = document.getElementById('gift-unlock-fill');
    var remEl = document.getElementById('gift-unlock-remaining');
    if (titleEl) titleEl.textContent = 'Special Episode ' + targetEp;
    // Find highest trust across all members
    var trustKeys = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST'];
    var maxTrust = Math.max.apply(null, trustKeys.map(function(k) { return gameState.stats[k] || 0; }));
    var pct = Math.min(100, Math.round((maxTrust / targetTrustReq) * 100));
    if (maxTrust >= targetTrustReq) {
      if (subEl) subEl.textContent = 'Your bond is strong enough. Finish episode ' + targetEp + ' to unlock.';
      if (fillEl) fillEl.style.width = '100%';
      if (remEl) remEl.textContent = '✓ Ready to unlock';
    } else {
      var rem = targetTrustReq - maxTrust;
      if (subEl) subEl.textContent = 'Build trust to unlock a special episode';
      if (fillEl) fillEl.style.width = pct + '%';
      if (remEl) remEl.textContent = rem + ' more trust needed';
    }
  }

  function openGiftScreen() {
    gameState.lastGiftEpisode = Number(gameState.currentEpisodeN || gameState.lastGiftEpisode || 0) || 0;
    try { saveGame(); } catch (e) { /* ignore */ }

    var pick = document.getElementById('gift-phase-select');
    var thx = document.getElementById('gift-phase-thanks');
    if (thx) thx.classList.add('gift-phase--hidden');
    if (pick) pick.classList.remove('gift-phase--hidden');
    resetGiftPickerUi();
    refreshGiftMemberCells();
    // Update coin display
    var coinDisplay = document.getElementById('gift-coin-display');
    if (coinDisplay) coinDisplay.textContent = '🪙 ' + (gameState.stats.COINS || 0);
    // Update unlock teaser
    refreshGiftUnlockTeaser();
    // Update afford states
    updateGiftConfirmState();
    // Pre-select the member the player just texted
    if (lastTxtMember) {
      var preCell = document.querySelector('.gift-member-cell[data-member="' + lastTxtMember + '"]');
      if (preCell && !preCell.disabled) {
        preCell.click();
      }
    }
    var ov = document.getElementById('gift-overlay');
    if (ov) {
      ov.classList.add('show');
      ov.setAttribute('aria-hidden', 'false');
    }
  }

  function initGiftUi() {
    if (window._giftUiInitialized) return;
    window._giftUiInitialized = true;

    if (giftUiInitialized) return;
    var ov = document.getElementById('gift-overlay');
    if (!ov) return;
    giftUiInitialized = true;
    document.querySelectorAll('.gift-member-cell').forEach(function (el) {
      el.addEventListener('click', function () {
        if (el.disabled) return;
        document.querySelectorAll('.gift-member-cell').forEach(function (x) {
          x.classList.remove('gift-member--selected');
        });
        el.classList.add('gift-member--selected');
        giftPickMember = el.getAttribute('data-member');
        updateGiftConfirmState();
      });
    });
    document.querySelectorAll('.gift-opt').forEach(function (el) {
      el.addEventListener('click', function () {
        document.querySelectorAll('.gift-opt').forEach(function (x) {
          x.classList.remove('gift-opt--selected');
        });
        el.classList.add('gift-opt--selected');
        giftPickType = el.getAttribute('data-gift');
        updateGiftConfirmState();
      });
    });
    var confirmBtn = document.getElementById('gift-btn-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if (!giftPickMember || !giftPickType) return;
        if (giftPickMember === gameState.lastGiftMember) return;
        var cost = giftCurrentCost();
        if ((gameState.stats.COINS || 0) < cost) return;

        // Prevent double-purchase on rapid clicks.
        confirmBtn.disabled = true;

        var memberKey = String(giftPickMember || '').trim();
        var giftKey = String(giftPickType || '').trim();
        var isMeaningful = GIFT_MEANINGFUL_KEYS.indexOf(giftKey) !== -1;

        var prev = {};
        Object.keys(gameState.stats).forEach(function (k) { prev[k] = gameState.stats[k]; });

        gameState.stats.COINS = Math.max(0, (gameState.stats.COINS || 0) - cost);
        var tKey = memberKey + '_TRUST';
        if (gameState.stats[tKey] !== undefined) {
          var trustGain = isMeaningful ? 2 : 1;
          gameState.stats[tKey] = clampStat(tKey, (gameState.stats[tKey] || 0) + trustGain);
        }
        gameState.lastGiftMember = memberKey;

        try { saveGame(); } catch (e) { /* ignore */ }
        try { renderStatsSidebar(prev); } catch (e) { /* ignore */ }

        showGiftThanks(memberKey, giftKey);
      });
    }
    var skipEl = document.getElementById('gift-btn-skip');
    if (skipEl) {
      skipEl.onclick = function () {
        hideGiftOverlay();
        finishEpisodeFlow();
      };
    }
    var contEl = document.getElementById('gift-btn-continue');
    if (contEl) {
      contEl.onclick = function () {
        hideGiftOverlay();
        finishEpisodeFlow();
      };
    }
  }

  window.rewardPopupContinue = function () {
    hideRewardPopup();
    var KOFI_TRIGGERS = [3, 8, 14, 18];
    var ep = gameState.currentEpisodeN;
    var kofiKey = 'calix_kofi_shown_ep' + ep;
    if (KOFI_TRIGGERS.indexOf(ep) !== -1 && !localStorage.getItem(kofiKey)) {
      localStorage.setItem(kofiKey, '1');
      if (window.Capacitor) {
        // iOS 앱 — IAP 자리 (나중에 연결)
        proceedFromRewardPopupToRewardScreen();
      } else {
        var ov = document.getElementById('kofi-overlay');
        if (ov) {
          var KOFI_MESSAGES = {
            3: {
              eyebrow: 'You\'re 3 episodes in ☕',
              headline: 'Enjoying CALIX so far?',
              body: 'This is a one-person project. If you\'re having fun, a coffee would genuinely make my day.',
              btn: 'Sure, buy a coffee ☕',
              skip: 'Maybe later'
            },
            8: {
              eyebrow: 'Eight episodes deep 🎧',
              headline: 'Still here. So am I.',
              body: 'I built this alone — every scene, every choice, every line of code. If CALIX has been worth your time, a coffee keeps it going.',
              btn: 'Buy me a coffee ☕',
              skip: 'Not right now'
            },
            14: {
              eyebrow: 'Episode 14. You\'re really here. 🌙',
              headline: 'This one means a lot to me.',
              body: 'I wrote CALIX because I needed a story like this to exist. You playing it this far means more than I can explain. If you want to help me keep making it — a coffee goes a long way.',
              btn: 'I want to support this ☕',
              skip: 'Keep going for now'
            },
            18: {
              eyebrow: 'Episode 18. Almost at the end. 🥺',
              headline: 'I made this game for people like you.',
              body: 'I don\'t say this lightly — I poured everything into CALIX. Late nights, rewrites, moments where I almost stopped. If this story has stayed with you at all... a coffee is how you tell me it was worth it. It really is.',
              btn: '☕ Buy me a coffee',
              skip: 'I\'ll think about it'
            }
          };
          var msg = KOFI_MESSAGES[ep] || KOFI_MESSAGES[3];
          var eyebrow = ov.querySelector('.kofi-eyebrow');
          var headline = ov.querySelector('.kofi-headline');
          var body = ov.querySelector('.kofi-body');
          var btn = ov.querySelector('.kofi-btn');
          var skip = ov.querySelector('.kofi-skip');
          if (eyebrow) eyebrow.textContent = msg.eyebrow;
          if (headline) headline.textContent = msg.headline;
          if (body) body.textContent = msg.body;
          if (btn) btn.textContent = msg.btn;
          if (skip) skip.textContent = msg.skip;
          ov.classList.add('show'); return;
        }
        proceedFromRewardPopupToRewardScreen();
      }
      return;
    }
    proceedFromRewardPopupToRewardScreen();
  };

  window.closeKofiCard = function () {
    var ov = document.getElementById('kofi-overlay');
    if (ov) ov.classList.remove('show');
    proceedFromRewardPopupToRewardScreen();
  };

  window.pickEpisodeChoice = function () {};
  window.finishEpisode = function () {};

  function setupCandidateGrid() {
    const grid = document.getElementById('candidate-grid');
    const track = document.getElementById('carousel-track');
    if (!grid || !track) return;
    if (grid.querySelector('.nc-card')) return;

    var cards = Array.prototype.slice.call(track.querySelectorAll('.nc-card'));
    cards.sort(function (a, b) {
      var ia = CANDIDATE_FAN_ORDER.indexOf(a.dataset.name || '');
      var ib = CANDIDATE_FAN_ORDER.indexOf(b.dataset.name || '');
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia - ib;
    });
    cards.forEach(function (card, idx) {
      if (card.dataset.body) {
        card.dataset.body = card.dataset.body.replace(
          'no one knew was missing',
          'no one knew they needed'
        );
      }
      const name = card.dataset.name || '';

      card.querySelectorAll('.nc-card-info').forEach(function (n) {
        n.remove();
      });
      var cImg = card.querySelector('img');
      if (cImg) cImg.setAttribute('alt', '');

      const info = document.createElement('div');
      info.className = 'nc-card-info';
      info.innerHTML =
        '<span class="nc-card-name">' +
        escapeHtml(CANDIDATE_FULL_NAMES[name] || name) +
        '</span><button type="button" class="nc-card-readmore">READ MORE</button>';
      const readBtn = info.querySelector('.nc-card-readmore');
      readBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openCandidateDetail(card);
      });

      card.appendChild(info);
      card.className = 'nc-card nc-card-grid';
      card.setAttribute('data-fan-pos', String(idx));
      card.onmouseenter = null;
      card.onclick = null;
      grid.appendChild(card);
    });
    selectedCardEl = null;
    candidateDetailCard = null;
  }

  function buildCandidateStoryHtml(prof) {
    const parts = [];
    function splitParas(s) {
      if (!s) return [];
      return String(s)
        .split(/\n\s*\n/)
        .map(function (t) {
          return t.replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean);
    }
    splitParas(prof.previous).forEach(function (p) {
      parts.push('<p class="cd-panel-para">' + escapeHtml(p) + '</p>');
    });
    ['gave', 'brought', 'shadow'].forEach(function (key) {
      const t = prof[key];
      if (t && t !== '—') parts.push('<p class="cd-panel-para">' + escapeHtml(t) + '</p>');
    });
    return parts.length ? parts.join('') : '<p class="cd-panel-para">—</p>';
  }

  function openCandidateDetail(card) {
    candidateDetailCard = card;
    const name = card.dataset.name || '';
    const nameEl = document.getElementById('cd-name');
    if (nameEl) nameEl.textContent = CANDIDATE_FULL_NAMES[name] || name;
    var CANDIDATE_KOREAN_NAMES = { ALEX: 'Lee Tae Yoon', GREY: 'Woo Won Jin' };
    var koreanNameEl = document.getElementById('cd-korean-name');
    if (koreanNameEl) koreanNameEl.textContent = CANDIDATE_KOREAN_NAMES[name] || '';

    var photoWrap = document.getElementById('candidate-detail-photo');
    var srcImg = card.querySelector('img');
    if (photoWrap) {
      var CANDIDATE_EXTRA_PHOTOS = {
        YOOJIN: ['Images/02_Candidates/Yoojin_1.png', 'Images/02_Candidates/Yoojin_2.png'],
        ALEX:   ['Images/02_Candidates/Alex_1.png',   'Images/02_Candidates/Alex_2.png'],
        GREY:   ['Images/02_Candidates/Grey_1.png',   'Images/02_Candidates/Grey_2.png'],
      };
      var mainSrc = srcImg && srcImg.src ? srcImg.src : '';
      var extras = CANDIDATE_EXTRA_PHOTOS[name] || [];
      var allPhotos = [mainSrc].concat(extras).filter(Boolean);
      var slideIdx = 0;

      var sliderHtml = '<div class="cd-photo-slider"><div class="cd-photo-track" id="cd-track">';
      allPhotos.forEach(function(src) {
        sliderHtml += '<div class="cd-photo-slide"><img src="' + src + '" alt=""></div>';
      });
      sliderHtml += '</div></div>';
      if (allPhotos.length > 1) {
        sliderHtml += '<div class="cd-photo-dots" id="cd-dots">';
        allPhotos.forEach(function(_, i) {
          sliderHtml += '<div class="cd-photo-dot' + (i === 0 ? ' active' : '') + '"></div>';
        });
        sliderHtml += '</div>';
        sliderHtml += '<div class="cd-photo-more" id="cd-more-photos">more photos &rarr;</div>';
      }
      photoWrap.innerHTML = sliderHtml;

      if (allPhotos.length > 1) {
        photoWrap.onclick = function() {
          slideIdx = (slideIdx + 1) % allPhotos.length;
          var track = document.getElementById('cd-track');
          if (track) track.style.transform = 'translateX(-' + (slideIdx * 100) + '%)';
          var dots = photoWrap.querySelectorAll('.cd-photo-dot');
          dots.forEach(function(d, i) { d.classList.toggle('active', i === slideIdx); });
          var moreEl = document.getElementById('cd-more-photos');
          if (moreEl) moreEl.style.opacity = slideIdx === allPhotos.length - 1 ? '0' : '1';
        };
      }
    }

    const prof = candidateBackstories[name] || {};
    const originEl = document.getElementById('cd-origin');
    const storyEl = document.getElementById('cd-story');
    if (originEl) originEl.textContent = prof.origin || card.dataset.origin || '—';
    if (storyEl) storyEl.innerHTML = buildCandidateStoryHtml(prof);

    const chooseBtn = document.getElementById('candidate-choose-btn');
    if (chooseBtn) chooseBtn.textContent = 'Choose ' + (CANDIDATE_FULL_NAMES[name] || name);

    const ov = document.getElementById('candidate-detail-overlay');
    if (ov) {
      ov.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  window.closeCandidateDetail = function (e) {
    if (e && e.target !== e.currentTarget) return;
    const ov = document.getElementById('candidate-detail-overlay');
    if (ov) ov.classList.remove('open');
    document.body.style.overflow = '';
    candidateDetailCard = null;
  };

  window.candidateConfirmFromDetail = function () {
    if (!candidateDetailCard) return;
    selectedCardEl = candidateDetailCard;
    window.closeCandidateDetail();
    window.confirmChoose();
  };

  window.initCarousel = function () {
    loadCandidateProfiles().finally(function () {
      setupCandidateGrid();
    });
  };

  window.selectCard = function () {};
  window.resetInfo = function () {};
  window.hoverCard = function () {};
  window.showInfo = function () {};

  window.chooseFilter = function () {};
  window.startCarouselScroll = function () {};
  window.stopCarouselScroll = function () {};

  async function bootData() {
    try {
      const idx = await fetchText(BASE + 'episodes-index.json');
      episodesIndex = JSON.parse(idx).episodes || [];
      const mapMd = await fetchText(BASE + 'EPISODES_MAP.md');
      episodesMapMeta = parseEpisodesMap(mapMd);
    } catch (e) {
      console.warn('CALIX bootData', e);
    }
  }

  const screens = ['s-title', 's-hook', 's-situation', 's-members', 's-choose', 's-episode', 's-reward'];
  const stepLabels = ['01 / 07', '02 / 07', '03 / 07', '04 / 07', '05 / 07', '06 / 07', '07 / 07'];
  let cur = 0;

  window.go = function (idx) {
    if (idx === 'ep1') {
      window.location.href = 'calix-ep1.html';
      return;
    }
    const el = document.querySelector('.screen.active');
    if (el) {
      el.classList.remove('visible');
      setTimeout(function () {
        el.classList.remove('active');
        window.showScreen(idx);
      }, 600);
    } else window.showScreen(idx);
  };

  window.showScreen = function (idx) {
    cur = idx;
    const panel = document.getElementById(screens[idx]);
    if (!panel) return;
    panel.classList.add('active');
    setTimeout(function () {
      panel.classList.add('visible');
    }, 30);
    screens.forEach(function (_, i) {
      const dot = document.getElementById('d' + i);
      if (dot) dot.classList.toggle('on', i === idx);
    });
    const ns = document.getElementById('nav-step');
    if (ns) ns.textContent = stepLabels[idx];
    const bb = document.getElementById('btn-back');
    if (bb) bb.disabled = idx === 0 || idx >= 5;  // no back from episode/reward screens
    const bf = document.getElementById('btn-fwd');
    if (bf) bf.disabled = idx >= 5;  // no forward arrow from episode/reward screens
    syncNavIdentity();
    const ds = document.getElementById('dev-select');
    if (ds) ds.value = idx;
    if (idx === 3 && typeof window.initMembers === 'function') window.initMembers();
    if (idx === 4 && typeof window.initCarousel === 'function') window.initCarousel();
    if (idx === 5 && typeof window.initEpisode === 'function') window.initEpisode();
    if (idx === 6 && typeof window.initReward === 'function') window.initReward();
  };

  window.navBack = function () {
    if (cur > 0) window.go(cur - 1);
  };
  window.navFwd = function () {
    if (cur < screens.length - 1) window.go(cur + 1);
  };

  const memberData = [
    {
      role: 'Leader · Vocal',
      name: 'Kain',
      origin: 'Seoul · Age 23',
      quote: '"He doesn\'t speak unless it matters. When he does — you listen."',
      desc: "Kain has been leading CALIX since day one — and he's never once had to raise his voice to do it. He's the kind of person who walks into a room and changes the temperature without saying a word. Direct. Focused. A little hard to read. The members trust him completely. Whether he trusts you back? That's up to you.",
      img: 'Images/01_Current members/Kain_Intro.png',
    },
    {
      role: 'Main Dancer',
      name: 'Theo',
      origin: 'Vancouver · Age 22',
      quote: '"Friendly until he isn\'t. The line\'s just hard to see."',
      desc: "Theo is the one the cameras find first — and he knows exactly what that means. He's warm, encouraging, easy to be around. Until he isn't. His standard for himself is absolute. When it slips — or when he thinks yours does — something goes cold. He doesn't get angry. He just gets quiet in a different way than Kain. More precise. And harder to come back from.",
      img: 'Images/01_Current members/Theo_Intro.png',
    },
    {
      role: 'Main Rapper',
      name: 'Jay',
      origin: 'Los Angeles · Age 22',
      quote: '"4D on the outside. Razor sharp on the inside."',
      desc: "Jay is the one cracking jokes when rehearsals run late. He's loud, unpredictable, and completely himself — always. What people miss is how much he's paying attention underneath all that energy. He doesn't get close to many people. But when he decides you're worth it, he's all in. Getting there takes more than making him laugh.",
      img: 'Images/01_Current members/Jay_Intro.png',
    },
    {
      role: 'Maknae · Dancer',
      name: 'Finn',
      origin: 'Sydney · Age 20',
      quote: '"Youngest. Probably the most dangerous."',
      desc: "Finn is the youngest — and he absolutely knows it. He showed up at eighteen with a big smile and zero experience, and somehow made it work. These days he's the one keeping the group sane when things get tense. But he notices things. More than most people realize. That smile hides a lot.",
      img: 'Images/01_Current members/Finn_Intro.png',
    },
  ];

  let curMemberIdx = 0;
  window.openMember = function (idx) {
    const m = memberData[idx];
    curMemberIdx = idx;
    const imgEl = document.getElementById('detail-img-el');
    if (imgEl && m.img) { imgEl.src = m.img; imgEl.alt = m.name; }
    document.getElementById('detail-role').textContent = m.role;
    document.getElementById('detail-name').textContent = m.name;
    document.getElementById('detail-origin').textContent = m.origin;
    document.getElementById('detail-quote').textContent = m.quote;
    document.getElementById('detail-desc').textContent = m.desc;
    const btn = document.getElementById('detail-next-btn');
    if (idx < memberData.length - 1) {
      btn.textContent = 'Next — ' + memberData[idx + 1].name + ' →';
      btn.onclick = function () {
        window.openMember(idx + 1);
      };
    } else {
      btn.textContent = 'Choose the fifth member →';
      btn.onclick = function () {
        window.closeMember();
        window.go(4);
      };
    }
    document.getElementById('member-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeMember = function () {
    document.getElementById('member-overlay').classList.remove('open');
    document.body.style.overflow = '';
  };

  window.closeMemberOverlay = function (e) {
    if (e.target === document.getElementById('member-overlay')) window.closeMember();
  };

  window.initMembers = function () {};

  initGiftUi();
  bootData().then(function () {
    var params = new URLSearchParams(window.location.search);
    var epParam = params.get('ep');
    if (epParam) {
      var epN = parseInt(epParam, 10);
      if (!isNaN(epN) && epN >= 1 && epN <= 30) {
        // 에피소드 화면으로 바로 점프 (개발/테스트용)
        gameState.currentEpisodeN = epN;
        gameState.unlockedThrough = epN;
        // 캐릭터 미선택 시 기본값 세팅
        if (!gameState.candidateName) {
          gameState.candidateName = 'ALEX';
          gameState.candidateArchetype = 'STRONG';
          gameState.candidateBlurb = '';
        }
        window.showScreen(5); // s-episode (initEpisode → startEpisode 자동 호출)
        return;
      }
    }
    // URL preview param: ?preview=special10&member=finn
    var urlParams = new URLSearchParams(window.location.search);
    var preview = urlParams.get('preview');
    var previewMember = (urlParams.get('member') || 'finn').toLowerCase();
    if (preview === 'special10' || preview === 'special20') {
      var previewEp = preview === 'special10' ? 10 : 20;
      var splash2 = document.getElementById('splash-screen');
      if (splash2) splash2.style.display = 'none';
      setTimeout(function() { launchSpecialEpisode(previewEp, previewMember); }, 300);
      return;
    }

    window.showScreen(0);

    // Dismiss splash screen
    var splash = document.getElementById('splash-screen');
    if (splash) {
      setTimeout(function() {
        splash.style.opacity = '0';
        setTimeout(function() { splash.style.display = 'none'; }, 800);
      }, 1200);
    }
  });
})();
