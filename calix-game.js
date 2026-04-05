/* CALIX — static game engine (fetch Context/*.md + scripts via relative paths only) */
(function () {
  'use strict';

  const BASE = 'Context/';
  const SCRIPTS = BASE + 'scripts/';

  const TRUST_KEYS = ['KAIN_TRUST', 'THEO_TRUST', 'JAY_TRUST', 'FINN_TRUST'];
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
  let lastNarrationFp = '';
  let lastDialogueDedup = '';
  /** First "the new member" replacement per speaker class within one episode stream. */
  let newMemberInject = { theo: false, kain: false, narr: false };
  /** Per scene: first vocative prefix applied per member speaker (THEO, KAIN, …). */
  let firstAddressPrefixBySpeaker = {};
  const MEMBER_SPEAKERS = { THEO: true, KAIN: true, JAY: true, FINN: true };
  let currentEpisodeTitle = '';
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
        return '🍿 Snack' + (m ? ' — from ' + m : '');
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
              label: String(o.label).replace(/\*\*/g, ''),
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
    if (/\bphotocard|photo[\s-]?card|polaroid\b/.test(blob)) return { key: 'photocard', label: 'Photocard' };
    if (/\bdrink\b|\bcoffee\b|\blatte\b|\btea\b|\bsoda\b|\bjuice\b|\bwater\b|water bottle|energy drink/.test(blob))
      return { key: 'drink', label: 'Drink' };
    if (/\bcandy\b|candy bar/.test(blob)) return { key: 'candy', label: 'Candy' };
    if (/\bfan\s+gift\b/.test(blob)) return { key: 'fan_gift', label: 'Fan gift' };
    if (/\bnotebook\b/.test(blob)) return { key: 'notebook', label: 'Notebook' };
    if (/\bsnack\b|\bchips\b|\bfood\b|\btreat\b/.test(blob)) return { key: 'snack', label: 'Snack' };
    if (/\baccessory\b|\bcharm\b|\bkeychain\b|\bbenie\b|\bhat\b|\bmerch\b|\bearring\b|\bnecklace\b|\bpendant\b|\bwristband\b|\bbracelet\b|\bring\b/.test(blob)) {
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
  }

  window.episodeLockedContinue = function () {
    if (typeof go === 'function') go(6);
    if (typeof window.initReward === 'function') window.initReward();
  };

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
      '<span id="nav-identity-name"><strong>You\'re ' +
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
      appendStreamBlock('<div class="scene-sep">—</div>', '');
      return;
    }

    if (beat.type === 'dialogue') {
      const injected = applyCandidateToEpisodeText(beat.text, 'dialogue', beat.speaker);
      const trimmed = trimDialogueForReader(injected);
      if (!trimmed) return;
      const dk = beat.speaker + '|' + textFingerprint(trimmed);
      if (dk === lastDialogueDedup) return;
      lastDialogueDedup = dk;
      lastNarrationFp = '';
      appendStreamBlock(
        '<div class="character-name">' +
          escapeHtml(beat.speaker) +
          '</div><div class="dialogue-text">' +
          escapeHtml(trimmed).replace(/\n/g, '<br>') +
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

    beat.options.forEach(function (opt) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-btn';
      btn.textContent = toSentenceCase(stripStatTags(opt.label) || opt.label);
      btn.onclick = function () {
        applyDeltas(opt.effects);
        const epk = String(gameState.currentEpisodeN);
        if (!gameState.episodeChoices[epk]) gameState.episodeChoices[epk] = [];
        gameState.episodeChoices[epk].push({ key: opt.key, label: stripStatTags(opt.label) });
        saveGame();
        bar.innerHTML =
          '<p class="choice-picked">Selected · ' +
          escapeHtml(toSentenceCase(stripStatTags(opt.label) || opt.label)) +
          '</p>';
        const sub = storySegmentToBeats(unwrapChoiceBody(opt.body));
        const tail = flowQueue.slice(flowIdx + 1);
        flowQueue = sub.concat(tail);
        flowIdx = 0;
        lastNarrationFp = '';
        lastDialogueDedup = '';
        flushContinuousSegment();
      };
      bar.appendChild(btn);
    });

    section.appendChild(prompt);
    section.appendChild(bar);
    stream.appendChild(section);
  }

  function endEpisodeFlow() {
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
      pendingReward.coins = 100;
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
        const PHOTOCARD_PLACEHOLDERS = [
          'https://picsum.photos/seed/calix-card-1/300/400',
          'https://picsum.photos/seed/calix-card-2/300/400',
          'https://picsum.photos/seed/calix-card-3/300/400',
          'https://picsum.photos/seed/calix-card-4/300/400',
        ];
        const cardIndex = gameState.photocardCount % PHOTOCARD_PLACEHOLDERS.length;
        const imgSrc = PHOTOCARD_PLACEHOLDERS[cardIndex];
        typeEl.innerHTML = '<img src="' + imgSrc + '" alt="Photocard ' + (cardIndex + 1) + '" class="rw-photocard-img">';
        gameState.photocardCount += 1;
        saveGame();
      } else if (pendingReward.typeKey === 'accessory') {
        var accName = (mapParts.accessoryName || pendingReward.itemLabel || 'Accessory').trim();
        var accMember = (mapParts.member || '').trim();
        var accSeed = 'calix-acc-' + accName.toLowerCase().replace(/\s+/g, '-');
        var accImg = 'https://picsum.photos/seed/' + encodeURIComponent(accSeed) + '/300/400';
        var accCaption = accName + (accMember ? ' — from ' + accMember : '');
        typeEl.innerHTML =
          '<img src="' + accImg + '" alt="' + escapeHtml(accName) + '" class="rw-photocard-img">' +
          '<p class="rw-accessory-label">' + escapeHtml(accCaption) + '</p>';
      } else if (pendingReward.typeKey === 'fan_gift') {
        var fgName = (pendingReward.itemLabel || mapParts.rightPlain || 'Gift').replace(/fan\s+gift/i, '').trim();
        if (!fgName) fgName = 'Gift';
        var fgSeed = 'calix-fangift-' + fgName.toLowerCase().replace(/\s+/g, '-');
        var fgImg = 'https://picsum.photos/seed/' + encodeURIComponent(fgSeed) + '/300/400';
        typeEl.innerHTML =
          '<img src="' + fgImg + '" alt="' + escapeHtml(fgName) + '" class="rw-photocard-img">' +
          '<p class="rw-accessory-label">Gift from a fan</p>';
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

    const BANNER_EPISODES = [1, 4, 7, 10, 13, 17, 20, 24, 27, 30];
    const bannerEl = document.getElementById('ep-banner');
    const bannerImg = document.getElementById('ep-banner-img');
    if (bannerEl && bannerImg) {
      if (BANNER_EPISODES.indexOf(n) !== -1) {
        bannerImg.src = 'https://picsum.photos/seed/calix-ep' + n + '/800/450';
        bannerImg.alt = 'Episode ' + n;
        bannerEl.style.display = '';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    flowQueue = buildFlowFromMarkdown(md);
    flowIdx = 0;
    lastNarrationFp = '';
    lastDialogueDedup = '';
    episodeChoiceStatDelta = {};
    const streamEl = document.getElementById('scene-stream');
    if (streamEl) streamEl.scrollTop = 0;
    flushContinuousSegment();
  }

  window.initEpisode = function () {
    giftShownThisEpisode = false;
    loadSave();
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
    document.getElementById('ov-body').textContent = gameState.candidateBlurb;
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

    // === GIFT NUDGE ===
    var nudgeEl = document.getElementById('reward-gift-nudge');
    if (nudgeEl) {
      var nudgeMembers = ['KAIN', 'THEO', 'JAY', 'FINN'];
      var nudgeGifts = ['an iced americano 🧋', 'a protein bar 💪', 'some candy 🍬', 'an energy drink ⚡', 'a vitamin jelly 🌟'];
      var nudgeMember = nudgeMembers[Math.floor(Math.random() * nudgeMembers.length)];
      var nudgeGift = nudgeGifts[Math.floor(Math.random() * nudgeGifts.length)];
      nudgeEl.style.display = '';
      nudgeEl.innerHTML = '<div style="margin-top:24px;padding:20px;background:rgba(255,255,255,0.65);border:1.5px solid #7c6aed;border-radius:16px;text-align:center;font-family:\'Rethink Sans\',sans-serif;">'
        + '<p style="margin:0 0 12px;font-size:18px;color:#3d2f8f;font-weight:500;">Buy ' + nudgeMember + ' ' + nudgeGift + '?</p>'
        + '<div id="gift-nudge-img" style="width:130px;height:130px;border-radius:16px;background:rgba(255,255,255,0.5);border:1.5px solid #7c6aed;margin:0 auto 16px;"></div>'
        + '<div id="gift-nudge-btns" style="display:flex;gap:10px;justify-content:center;">'
        + '<button id="gift-nudge-yes" style="padding:10px 20px;background:#7c6aed;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-family:\'Rethink Sans\',sans-serif;">Send it! 🎁</button>'
        + '<button id="gift-nudge-skip" style="padding:10px 20px;background:transparent;color:#7c6aed;border:1.5px solid #7c6aed;border-radius:10px;font-size:14px;cursor:pointer;font-family:\'Rethink Sans\',sans-serif;">Maybe next time</button>'
        + '</div>'
        + '<div id="gift-nudge-thanks" style="display:none;font-size:16px;color:#3d2f8f;margin-top:12px;"></div>'
        + '</div>';

      document.getElementById('gift-nudge-yes').onclick = function() {
        if ((gameState.stats.COINS || 0) < 50) {
          document.getElementById('gift-nudge-thanks').style.display = '';
          document.getElementById('gift-nudge-thanks').textContent = 'Not enough coins 🥲';
          return;
        }
        gameState.stats.COINS = Math.max(0, (gameState.stats.COINS || 0) - 50);
        var affinityKey = nudgeMember + '_AFFINITY';
        if (gameState.stats[affinityKey] !== undefined) {
          gameState.stats[affinityKey] = Math.min(100, (gameState.stats[affinityKey] || 0) + 1);
        }
        var thanks = {
          KAIN: 'Thank you. I appreciate it. 🙂',
          THEO: 'Oh wow, really? Thank you so much! ☺️',
          JAY: 'Ayy thanks!! You already knew what I needed 🤙',
          FINN: 'Oh my gosh, thank you!! This is literally my favorite 😊'
        };
        document.getElementById('gift-nudge-btns').style.display = 'none';
        document.getElementById('gift-nudge-thanks').style.display = '';
        document.getElementById('gift-nudge-thanks').textContent = nudgeMember + ': ' + (thanks[nudgeMember] || 'Thank you! ☺️');
        var coinEl = document.getElementById('rw-tokens');
        if (coinEl) coinEl.textContent = gameState.stats.COINS || 0;
        try { saveGame(); } catch(e) {}
      };

      document.getElementById('gift-nudge-skip').onclick = function() {
        nudgeEl.style.display = 'none';
      };
    }
    // === END GIFT NUDGE ===
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

  const GIFT_COST = 100;
  const GIFT_THANK_YOU = {
    KAIN: {
      coffee: [
        "Thanks. I needed this.",
        "...You didn't have to do that.",
        "Good timing. I was running low.",
      ],
      snacks: [
        "I'll eat it after practice. Thanks.",
        "Leaving some for you.",
        "You keep doing this.",
      ],
    },
    THEO: {
      coffee: [
        "Wait — this is for me? Genuinely, thank you.",
        "I was dying for this. How did you know.",
        "You didn't have to. But I'm really glad you did.",
      ],
      snacks: [
        "You and snacks. Best combination.",
        "These are my favorites. You actually noticed that.",
        "I hadn't said anything but I was starving. Thank you.",
      ],
    },
    JAY: {
      coffee: [
        "Oh — thanks. You didn't have to.",
        "I'll drink it. Really, thank you.",
        "Didn't expect this. That was thoughtful.",
      ],
      snacks: [
        "We should eat together sometime. I'm serious.",
        "I hadn't eaten yet. How did you know that.",
        "Thanks. And I mean that, not just saying it.",
      ],
    },
    FINN: {
      coffee: [
        "This is so thoughtful. Thank you, seriously.",
        "You got this for me? That actually means a lot.",
        "I needed this more than you know. Thank you.",
      ],
      snacks: [
        "How did you know I liked these? This is really kind.",
        "You thought of me. I don't take that lightly.",
        "I'd been thinking about these all day. Did you just know?",
      ],
    },
  };
  const GIFT_MEMBER_LABEL = { KAIN: 'Kain', THEO: 'Theo', JAY: 'Jay', FINN: 'Finn' };

  let giftPickMember = null;
  let giftPickType = null;
  let giftUiInitialized = false;

  function proceedFromRewardPopupToRewardScreen() {
    if (!giftShownThisEpisode && shouldOfferGiftScreen()) {
      giftShownThisEpisode = true;
      openGiftScreen();
    } else {
      if (typeof go === 'function') go(6);
      if (typeof window.initReward === 'function') window.initReward();
    }
  }

  function shouldOfferGiftScreen() {
    return false;
  }

  function updateGiftConfirmState() {
    var btn = document.getElementById('gift-btn-confirm');
    if (btn) btn.disabled = !(giftPickMember && giftPickType);
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

  function openGiftScreen() {
    gameState.lastGiftEpisode = Number(gameState.currentEpisodeN || gameState.lastGiftEpisode || 0) || 0;
    try { saveGame(); } catch (e) { /* ignore */ }

    var pick = document.getElementById('gift-phase-select');
    var thx = document.getElementById('gift-phase-thanks');
    if (thx) thx.classList.add('gift-phase--hidden');
    if (pick) pick.classList.remove('gift-phase--hidden');
    resetGiftPickerUi();
    refreshGiftMemberCells();
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
        if ((gameState.stats.COINS || 0) < GIFT_COST) return;

        // Prevent double-purchase on rapid clicks.
        confirmBtn.disabled = true;

        var memberKey = String(giftPickMember || '').trim();
        var giftKey = String(giftPickType || '').trim();

        var prev = {};
        Object.keys(gameState.stats).forEach(function (k) {
          prev[k] = gameState.stats[k];
        });

        gameState.stats.COINS = Math.max(0, (gameState.stats.COINS || 0) - GIFT_COST);
        var tKey = memberKey + '_TRUST';
        if (gameState.stats[tKey] !== undefined) {
          gameState.stats[tKey] = clampStat(tKey, (gameState.stats[tKey] || 0) + 1);
        }
        gameState.lastGiftMember = memberKey;

        try { saveGame(); } catch (e) { /* ignore */ }
        try { renderStatsSidebar(prev); } catch (e) { /* ignore */ }

        // Always advance UI to thank-you, even if sidebar rendering fails.
        showGiftThanks(memberKey, giftKey);
      });
    }
    var skipEl = document.getElementById('gift-btn-skip');
    if (skipEl) {
      skipEl.onclick = function () {
        hideGiftOverlay();
        if (typeof go === 'function') go(6);
        if (typeof window.initReward === 'function') window.initReward();
      };
    }
    var contEl = document.getElementById('gift-btn-continue');
    if (contEl) {
      contEl.onclick = function () {
        hideGiftOverlay();
        if (typeof go === 'function') go(6);
        if (typeof window.initReward === 'function') window.initReward();
      };
    }
  }

  window.rewardPopupContinue = function () {
    hideRewardPopup();
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

    var photoWrap = document.getElementById('candidate-detail-photo');
    var srcImg = card.querySelector('img');
    if (photoWrap) {
      photoWrap.innerHTML = '';
      if (srcImg && srcImg.src) {
        var hero = document.createElement('img');
        hero.src = srcImg.src;
        hero.alt = '';
        photoWrap.appendChild(hero);
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
    if (bb) bb.disabled = idx === 0;
    const bf = document.getElementById('btn-fwd');
    if (bf) bf.disabled = idx === screens.length - 1;
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
  bootData();
  window.showScreen(0);
})();
