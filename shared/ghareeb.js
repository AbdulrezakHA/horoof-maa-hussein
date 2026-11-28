/**
 * «في بينا غريب» — منطق اللعبة (نقيّ، بلا واجهة)
 * ==============================================
 * وضعان:
 *   teams — كل فريق فيه غريب واحد (هو وضع نقاط السهرة)
 *   ffa   — غريب واحد للطاولة كلها (للمتعة فقط، بلا نقاط سهرة)
 *
 * القواعد:
 *  - كل اللاعبين يستلمون «الكلمة الأساسية»، والغريب يستلم كلمة قريبة مختلفة.
 *  - لا أحد يعرف من الغريب — ولا الغريب نفسه. الحكم وحده يعرف، والخادم يخفي الهوية عن الباقين.
 *  - المرحلة ١: كل فريق يصوّت سرّاً على لاعب من الفريق الآخر. الأغلبية = 50%+1 من أعضاء الفريق.
 *    لكل فريق فرصتان؛ كل تصويت خاطئ يحرق فرصة، وحرق الفرصة الثانية = خسارة الجولة.
 *    إذا حرق الفريقان فرصتهما الثانية في نفس الجولة ← المرحلة ٢.
 *  - المرحلة ٢: محاولة واحدة لكل فريق لتسمية الغريب داخل فريقه.
 *    الخطأ يعطي النقطة للفريق الآخر، ونجاح الاثنين أو فشل الاثنين = تعادل (نقطة لكل فريق).
 *  - التصويت يُفتح من الدور الثالث فصاعداً.
 *  - لا كشف لأي أصوات أثناء اللعب — الكشف الكامل عند نهاية اللعبة فقط.
 */

/** عدد الفرص في المرحلة الأولى (لكل فريق). */
export const GHAREEB_CHANCES = 2;
/** أقل دور يُسمح فيه بفتح التصويت (الأدوار ١ و٢ بلا تصويت). */
export const GHAREEB_VOTE_FROM_TURN = 3;

/** أسماء المراحل — للعرض في الواجهة. */
export const GHAREEB_PHASE_LABEL = {
  setup: "الإعداد",
  rules: "القوانين",
  deal: "توزيع الكلمات",
  turn: "دور سؤال",
  vote: "تصويت",
  guess: "تخمين الكلمة",
  p2: "المرحلة الثانية",
  result: "نتيجة الجولة",
  over: "نهاية اللعبة",
};

export function createGhareeb() {
  return {
    mode: "teams", // teams | ffa
    phase: "setup", // setup | rules | deal | turn | vote | guess | p2 | result | over
    fields: [], // المجالات المختارة (فارغة = كل المجالات)
    // --- الجولة الحالية ---
    word: "", // الكلمة الأساسية (يعرفها الجميع ما عدا الغريب)
    fieldName: "", // اسم المجال (لتسجيل النتيجة)
    odd: { a: null, b: null }, // معرّف الغريب في كل فريق (سري)
    oddWord: { a: "", b: "" }, // الكلمة القريبة لكل غريب (سري)
    // --- الأدوار ---
    n: 0, // رقم الدور (يبدأ من ١)
    askTeam: null, // الفريق الذي يسأل الآن: a | b
    askerId: null,
    targetId: null,
    bag: { askers: { a: [], b: [] }, targets: { a: [], b: [] } }, // حجر العشوائية العادلة
    // --- التصويت (سرّي بالكامل) ---
    ballots: { a: {}, b: {}, all: {} }, // { team: { playerId: targetId|"" } }
    chances: { a: GHAREEB_CHANCES, b: GHAREEB_CHANCES },
    p2: false, // هل نحن في المرحلة ٢؟
    // --- النتائج ---
    rounds: [], // [{ n, winner: 'a'|'b'|'draw', reason, word, fieldName, odd }]
    points: { a: 0, b: 0 }, // نقاط هذه اللعبة (مجموع الجولات)
    lastResult: null, // نتيجة آخر جولة (للعرض)
    history: [], // سجل كل جولة تصويت — لا يُكشف إلا عند النهاية
    winner: null, // a | b | draw | 'odd' (في الوضع الفردي: فوز الغريب)
    finisher: null, // 'players' | 'odd' (الوضع الفردي)
    guessOpen: false, // الوضع الفردي: هل يخمّن الغريب الكلمة؟
    guessOk: null, // هل أصاب الغريب؟
  };
}

export function cloneGhareeb(g) {
  const src = g || createGhareeb();
  return {
    ...src,
    fields: [...(src.fields || [])],
    odd: { ...(src.odd || {}) },
    oddWord: { ...(src.oddWord || {}) },
    ballots: {
      a: { ...(src.ballots?.a || {}) },
      b: { ...(src.ballots?.b || {}) },
      all: { ...(src.ballots?.all || {}) },
    },
    chances: { ...(src.chances || {}) },
    bag: {
      askers: { a: [...(src.bag?.askers?.a || [])], b: [...(src.bag?.askers?.b || [])] },
      targets: { a: [...(src.bag?.targets?.a || [])], b: [...(src.bag?.targets?.b || [])] },
    },
    rounds: (src.rounds || []).map((r) => ({ ...r, odd: { ...(r.odd || {}) } })),
    points: { ...(src.points || {}) },
    lastResult: src.lastResult ? { ...src.lastResult } : null,
    history: (src.history || []).map((h) => ({ ...h })),
  };
}

/** لاعبو فريق (بلا الأجراس الوهمية). */
export function teamPlayers(state, team) {
  return Object.values(state.players || {}).filter((p) => p.team === team && !p.pseudo);
}

/** الأغلبية المطلوبة = 50%+1 من عدد أعضاء الفريق. */
export function majorityOf(count) {
  return Math.floor(count / 2) + 1;
}

const other = (team) => (team === "a" ? "b" : "a");

/** سحب عادل: خلط عند نفاد الكيس — النتيجة تبدو عشوائية لكن التوزيع متساوٍ. */
function drawBag(pool, ids) {
  if (!pool.length) {
    pool.push(...ids);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return pool.pop() || null;
}

/**
 * يجهّز الدور التالي بعشوائية «عادلة غير مكشوفة»:
 * كل لاعب يُسأل ويُسأَل بعدد متساوٍ قبل أن يتكرّر أحد.
 * يعيد { team, askerId, targetId } أو null إذا لم يتوفر لاعبان.
 */
export function ghareebPickTurn(st) {
  const g = st.ghareeb || createGhareeb();
  const askTeam = g.askTeam ? other(g.askTeam) : "a"; // يتبادل الفريقان
  const askers = teamPlayers(st, askTeam);
  const targets = teamPlayers(st, other(askTeam));
  if (!askers.length || !targets.length) return null;
  const askerId = drawBag(g.bag.askers[askTeam], askers.map((p) => p.id));
  const targetId = drawBag(g.bag.targets[other(askTeam)], targets.map((p) => p.id));
  if (!askerId || !targetId) return null;
  return { team: askTeam, askerId, targetId };
}

/** عدد من صوّت في كل فريق (للإخفاء: نعرض العدد لا الاختيارات). */
export function ghareebVoteCounts(g) {
  return {
    a: Object.keys(g.ballots?.a || {}).length,
    b: Object.keys(g.ballots?.b || {}).length,
    all: Object.keys(g.ballots?.all || {}).length,
  };
}

/** هل يملك هذا اللاعب فريقاً صالحاً للتصويت الآن؟ (يُستخدم للتحقق في الخادم) */
export function canVote(g, state, playerId) {
  const p = state.players?.[playerId];
  if (!p) return false;
  if (g.mode === "ffa") return true;
  return p.team === "a" || p.team === "b";
}

/** نتيجة تصويت فريق: الهدف الفائز إن تجاوز الأغلبية، وإلا null (تصويت لم يمرّ). */
function passedBallot(g, team, count) {
  const need = majorityOf(count);
  const tally = {};
  for (const target of Object.values(g.ballots[team] || {})) {
    if (!target) continue; // تخطّي
    tally[target] = (tally[target] || 0) + 1;
  }
  let best = null;
  let bestN = 0;
  for (const [target, n] of Object.entries(tally)) {
    if (n > bestN) {
      best = target;
      bestN = n;
    }
  }
  return bestN >= need ? best : null;
}

/**
 * يحسم جولة التصويت.
 * يعيد { winner: 'a'|'b'|'draw'|null, reason, next: 'turn'|'p2'|'result' }
 */
function resolveVote(st, g) {
  const nA = teamPlayers(st, "a").length;
  const nB = teamPlayers(st, "b").length;

  // ---------- الوضع الفردي ----------
  if (g.mode === "ffa") {
    const total = nA + nB;
    const need = majorityOf(total);
    const tally = {};
    for (const target of Object.values(g.ballots.all || {})) {
      if (!target) continue;
      tally[target] = (tally[target] || 0) + 1;
    }
    let best = null;
    let bestN = 0;
    for (const [target, n] of Object.entries(tally)) {
      if (n > bestN) {
        best = target;
        bestN = n;
      }
    }
    if (!best || bestN < need) return { winner: null, reason: "لم يصل أحد إلى الأغلبية", next: "turn" };
    const isOdd = best === g.odd.a;
    if (isOdd) {
      g.finisher = "players";
      return { winner: "players", reason: "انكشف الغريب — فاز اللاعبون", next: "result" };
    }
    g.finisher = "odd";
    g.guessOpen = true;
    return { winner: "odd", reason: "أُخرج لاعب بريء — فاز الغريب", next: "guess" };
  }

  // ---------- المرحلة ٢ ----------
  if (g.p2) {
    const aTarget = passedBallot(g, "a", nA);
    const bTarget = passedBallot(g, "b", nB);
    const aRight = aTarget && aTarget === g.odd.a;
    const bRight = bTarget && bTarget === g.odd.b;
    if (aRight && bRight) return { winner: "draw", reason: "أصاب الفريقان غريبهما — تعادل", next: "result" };
    if (!aRight && !bRight) return { winner: "draw", reason: "أخطأ الفريقان — تعادل", next: "result" };
    return aRight
      ? { winner: "a", reason: "أصاب الأزرق غريبه", next: "result" }
      : { winner: "b", reason: "أصاب الأحمر غريبه", next: "result" };
  }

  // ---------- المرحلة ١ ----------
  const aTarget = passedBallot(g, "a", nA);
  const bTarget = passedBallot(g, "b", nB);
  const aFound = aTarget && aTarget === g.odd.b; // الفريق أ يسمّي غريب ب
  const bFound = bTarget && bTarget === g.odd.a;

  if (aFound && bFound) return { winner: null, reason: "أصاب الفريقان معاً — إلى المرحلة الثانية", next: "p2" };
  if (aFound) return { winner: "a", reason: "كشف الفريق الأزرق غريب الخصم", next: "result" };
  if (bFound) return { winner: "b", reason: "كشف الفريق الأحمر غريب الخصم", next: "result" };

  // لم يصب أحد: كل فريق صوّت فعلياً يحرق فرصة
  if (aTarget) g.chances.a = Math.max(0, g.chances.a - 1);
  if (bTarget) g.chances.b = Math.max(0, g.chances.b - 1);

  const aOut = g.chances.a <= 0;
  const bOut = g.chances.b <= 0;
  if (aOut && bOut) return { winner: null, reason: "أحرق الفريقان فرصتيهما — إلى المرحلة الثانية", next: "p2" };
  if (aOut) return { winner: "b", reason: "أحرق الأزرق فرصتيه — النقطة للحمر", next: "result" };
  if (bOut) return { winner: "a", reason: "أحرق الأحمر فرصتيه — النقطة للأزرق", next: "result" };
  return { winner: null, reason: "لم يصل أي فريق إلى الأغلبية", next: "turn" };
}

/** يسجّل جولة تصويت في السجل (يُكشف عند نهاية اللعبة فقط). */
function remember(st, g, result) {
  g.history.push({
    round: (g.lastResult?.n || g.rounds.length) + 1,
    p2: g.p2,
    ballots: {
      a: { ...(g.ballots.a || {}) },
      b: { ...(g.ballots.b || {}) },
      all: { ...(g.ballots.all || {}) },
    },
    winner: result.winner,
    reason: result.reason,
  });
}

/** ينهي الجولة الحالية ويسجّلها. */
function endRound(st, g, result) {
  const entry = {
    n: g.rounds.length + 1,
    winner: result.winner,
    reason: result.reason,
    word: g.word,
    fieldName: g.fieldName,
    odd: { ...g.odd },
    oddWord: { ...g.oddWord },
  };
  g.rounds.push(entry);
  if (result.winner === "a" || result.winner === "b" || result.winner === "draw") {
    if (result.winner === "draw") {
      g.points.a += 1;
      g.points.b += 1;
    } else {
      g.points[result.winner] += 1;
    }
  }
  if (result.winner === "players" || result.winner === "odd") g.winner = result.winner;
  g.lastResult = entry;
  g.phase = result.next === "guess" ? "vote" : "result";
}

const log = (text, tone = "info", icon = null) => ({ text, tone, icon });

/**
 * مُخفِّض اللعبة. يُعدّل st.ghareeb ويعيد سطر سجل أو null.
 */
export function applyGhareeb(st, type, p = {}) {
  const g = st.ghareeb;
  if (!g) return null;

  switch (type) {
    case "ghareebConfig": {
      if (p.mode === "teams" || p.mode === "ffa") g.mode = p.mode;
      if (Array.isArray(p.fields)) g.fields = p.fields.slice();
      return log("حُدِّثت إعدادات «في بينا غريب»", "info", "eye");
    }

    case "ghareebNew": {
      const fresh = createGhareeb();
      fresh.mode = p.mode === "ffa" ? "ffa" : g.mode;
      fresh.fields = Array.isArray(p.fields) ? p.fields.slice() : g.fields;
      fresh.phase = "rules";
      Object.assign(g, fresh);
      return log("لعبة جديدة — «في بينا غريب»", "info", "eye");
    }

    case "ghareebDeal": {
      // يمرّر الخادم الكلمات والغريب (عشوائية يجهّزها هو)
      g.word = p.word || "";
      g.fieldName = p.fieldName || "";
      g.oddWord = { a: p.oddWordA || "", b: p.oddWordB || p.oddWordA || "" };
      g.odd = { a: p.oddA || null, b: g.mode === "ffa" ? p.oddA || null : p.oddB || null };
      g.phase = "deal";
      g.n = 0;
      g.askTeam = null;
      g.askerId = null;
      g.targetId = null;
      g.ballots = { a: {}, b: {}, all: {} };
      g.chances = { a: GHAREEB_CHANCES, b: GHAREEB_CHANCES };
      g.p2 = false;
      g.guessOpen = false;
      g.guessOk = null;
      g.winner = null;
      g.finisher = null;
      g.lastResult = null;
      g.bag = { askers: { a: [], b: [] }, targets: { a: [], b: [] } };
      return log("وُزّعت الكلمات على اللاعبين", "info", "eye");
    }

    case "ghareebBegin":
    case "ghareebNextTurn": {
      if (type === "ghareebBegin") {
        g.n = 1;
      } else {
        g.n += 1;
      }
      g.askTeam = p.team || null;
      g.askerId = p.askerId || null;
      g.targetId = p.targetId || null;
      g.ballots = { a: {}, b: {}, all: {} };
      g.phase = "turn";
      if (type === "ghareebBegin") return log("بدأت الأدوار", "info", "eye");
      return null;
    }

    case "ghareebVoteOpen": {
      if (g.n < GHAREEB_VOTE_FROM_TURN) return null;
      if (g.phase !== "turn") return null;
      g.ballots = { a: {}, b: {}, all: {} };
      g.phase = "vote";
      return log(`فُتح التصويت (الدور ${g.n})`, "warn", "eye");
    }

    case "ghareebVote": {
      if (g.phase !== "vote" && g.phase !== "p2") return null;
      const voterId = p.playerId;
      const voter = st.players?.[voterId];
      if (!voter) return null;
      const target = p.targetId || ""; // فارغ = تخطّي
      if (target && target === voterId) return null; // لا تصويت للنفس
      if (g.mode === "ffa") {
        g.ballots.all[voterId] = target;
      } else {
        const team = voter.team;
        if (team !== "a" && team !== "b") return null;
        g.ballots[team][voterId] = target;
      }
      return null;
    }

    case "ghareebVoteClose": {
      if (g.phase !== "vote") return null;
      const result = resolveVote(st, g);
      remember(st, g, result);
      if (result.next === "result") endRound(st, g, result);
      else if (result.next === "guess") {
        g.ballots = { a: {}, b: {}, all: {} };
        g.phase = "guess";
      } else if (result.next === "p2") {
        g.p2 = true;
        g.chances = { a: 0, b: 0 };
        g.ballots = { a: {}, b: {}, all: {} };
        g.phase = "p2";
      } else {
        g.ballots = { a: {}, b: {}, all: {} };
        // نُبقي سبب الفشل ظاهراً للحكم واللاعبين حتى الدور التالي
        g.lastResult = {
          winner: null,
          reason: result.reason || "لم يكتمل أي تصويت",
          odd: g.odd,
          oddWord: g.oddWord,
        };
        g.phase = "turn";
      }
      return log(result.reason, result.winner ? "ok" : "warn", "eye");
    }

    case "ghareebP2Vote": {
      if (g.phase !== "p2") return null;
      const voterId = p.playerId;
      const voter = st.players?.[voterId];
      if (!voter) return null;
      const target = p.targetId || "";
      if (target && target === voterId) return null;
      if (voter.team !== "a" && voter.team !== "b") return null;
      g.ballots[voter.team][voterId] = target;
      return null;
    }

    case "ghareebP2Close": {
      if (g.phase !== "p2") return null;
      const result = resolveVote(st, g);
      remember(st, g, result);
      endRound(st, g, result);
      return log(result.reason, "ok", "eye");
    }

    case "ghareebGuess": {
      // الوضع الفردي: الغريب يخمّن الكلمة الأساسية (+١)
      if (!g.guessOpen) return null;
      g.guessOpen = false;
      const given = String(p.word || "").trim();
      const target = String(g.word || "").trim();
      g.guessOk = !!given && (given === target || given.replace(/\s+/g, "") === target.replace(/\s+/g, ""));
      g.phase = "result";
      g.lastResult = {
        n: g.rounds.length + 1,
        winner: "odd",
        reason: g.guessOk ? "الغريب عرف الكلمة — +١" : "الغريب لم يعرف الكلمة",
        word: g.word,
        fieldName: g.fieldName,
        odd: { ...g.odd },
        oddWord: { ...g.oddWord },
      };
      return log(g.guessOk ? "الغريب أصاب الكلمة" : "الغريب أخطأ الكلمة", "info", "eye");
    }

    case "ghareebEnd": {
      g.phase = "over";
      g.winner =
        g.mode === "ffa"
          ? g.finisher || g.winner || null
          : g.points.a > g.points.b
            ? "a"
            : g.points.b > g.points.a
              ? "b"
              : g.points.a === 0
                ? null
                : "draw";
      return log("انتهت اللعبة — كُشفت كل التفاصيل", "info", "eye");
    }

    case "ghareebReset": {
      Object.assign(g, createGhareeb(), { mode: g.mode, fields: g.fields });
      return log("صُفّرت لعبة «في بينا غريب»", "warn", "eye");
    }

    default:
      return null;
  }
}