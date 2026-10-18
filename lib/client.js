/**
 * DSH 健康钟插件 —— 浏览器半边（Client half）
 * ============================================================================
 *
 * 全部功能都在这一个文件里：计时、状态持久化、弹窗、提示音、标题闪烁。
 * 通过 DSH 的客户端模块表加载（`window.__ModuleLoader__.load({ id, factory })`），
 * 不需要任何编译步骤 —— 全部用 `React.createElement` 手写（与 dsh-work-diary 相同的做法）。
 *
 * ── 关键契约（照本机已验证的 dsh-work-diary / dsh-theme-pack 样板）──────────
 *  · 弹窗挂在 `shell.overlay`（ui-layout 声明为 { kind: 'list', scope: 'root' }，
 *    渲染在所有栏目上层、不受滚动区裁切）；
 *  · 注册写法：`ctx.slots.inject('shell.overlay', () => ctx.slots.register({...}, render))`，
 *    inject 返回退订函数，卸载时必须调用；
 *  · 入口按钮挂在 `sidebar.footer.action`（左下角那一排）；
 *  · 颜色尽量走主题令牌（--dsw-alias-*），卡片本身用一套暖色；
 *  · React 由 DSH 提供（require('react')），不自带。
 *
 * ── 计时原则（ADR-002 / ADR-012）─────────────────────────────────────────
 *  不数滴答，只记「该响的时刻」（deadline）。每次刷新显示都用 现在 − deadline 现算，
 *  电脑睡多久都不怕；监听 visibilitychange，页面一回来就立刻重算。
 *
 * ── 状态持久化（ADR-004）────────────────────────────────────────────────
 *  localStorage 存计时状态（刷新接着算）；sessionStorage 存「本次启动」标记
 *  （整个 DSH 退出再打开 → 标记没了 → 算新一轮）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-clock',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    // ── 常量 ────────────────────────────────────────────────────────────────
    /**
     * 开发模式：工作 2 分钟、休息 20 秒，方便反复测试。
     * 验收通过后把它改成 false，就恢复 45 分钟 + 各计划自带时长（ADR-011）。
     */
    const DEV_MODE = true;
    const WORK_SECONDS = DEV_MODE ? 120 : 45 * 60;
    const DEV_REST_SECONDS = 20;

    /** 客户端版本标记。改本文件时 +1，便于确认浏览器里跑的是新包。 */
    const CLIENT_VERSION = '0.1.0';

    /** localStorage / sessionStorage 键名（ADR-004）。 */
    const STORAGE_KEY = 'dsh-clock:state:v1';
    const SESSION_KEY = 'dsh-clock:session:v1';

    /** 注入样式表的元素 id，卸载时按它清理。 */
    const STYLE_ID = 'dsh-clock-style';

    /** 模块级单例挂在 window 上的键（热更新时清掉旧实例，ADR-010）。 */
    const STORE_SINGLETON_KEY = '__dshClockStore__';

    /** 长按紧急跳过需要的时长。 */
    const SKIP_HOLD_MS = 3000;

    /**
     * 休息计划库（ADR-006，第 2 轮改判）：每个计划 = 插图 + 任务 + 说明 + 建议休息时长。
     * restMinutes 在 10～15 之间，按计划强度定；DEV_MODE 下统一用 DEV_REST_SECONDS。
     * 到点随机抽一个，且不与上一个重复。
     */
    const REST_PLANS = [
      { id: 'squat', emoji: '🦵', title: '深蹲', detail: '15 个 × 4 组，站起来慢慢蹲', restMinutes: 15 },
      { id: 'tiptoe', emoji: '🦶', title: '踮脚尖', detail: '30 下 × 3 组，扶着桌沿也行', restMinutes: 10 },
      { id: 'flamingo', emoji: '🦩', title: '金鸡独立', detail: '左右脚各站 1 分钟 × 3 轮', restMinutes: 10 },
      { id: 'jumping-jack', emoji: '🤸', title: '开合跳', detail: '50 个 × 2 组，轻一点别吵到邻居', restMinutes: 12 },
      { id: 'chest', emoji: '💪', title: '扩胸运动', detail: '20 下 × 3 组，把肩膀打开', restMinutes: 10 },
      { id: 'neck', emoji: '🧘', title: '肩颈绕环', detail: '向前 10 圈、向后 10 圈，慢慢来', restMinutes: 10 },
      { id: 'wall-sit', emoji: '🧱', title: '靠墙静蹲', detail: '后背贴墙蹲 1 分钟 × 3 次', restMinutes: 13 },
      { id: 'high-knees', emoji: '🏃', title: '高抬腿', detail: '原地高抬腿 30 秒 × 4 组', restMinutes: 12 },
      { id: 'lunge', emoji: '🏋️', title: '弓步蹲', detail: '左右各 12 个 × 3 组', restMinutes: 14 },
      { id: 'glute-bridge', emoji: '🌉', title: '臀桥', detail: '躺下抬胯 15 个 × 3 组', restMinutes: 12 },
      { id: 'wrist', emoji: '🙌', title: '手腕手指操', detail: '手腕绕环 + 手指伸展各 1 分钟', restMinutes: 10 },
      { id: 'march', emoji: '🚶', title: '原地踏步', detail: '原地踏步 3 分钟，顺便倒杯水', restMinutes: 10 },
      { id: 'eyes', emoji: '👀', title: '远眺放松', detail: '看 6 米外 20 秒 × 5 次，眨眨眼', restMinutes: 10 }
    ];

    // ── 提示音（ADR-013）────────────────────────────────────────────────────
    // Web Audio 不需要授权；但浏览器自动播放策略要求「用户先和页面交互过」，
    // 所以在每次 pointerdown 时顺手解锁一次 AudioContext。
    let audioCtx = null;

    /** 创建/唤醒 AudioContext。失败就静默——没声音不该影响计时。 */
    function unlockAudio() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      } catch {
        /* 没有音频能力就算了 */
      }
    }

    /** 播一个带包络的正弦音。 */
    function tone(freq, startAt, duration) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.05);
    }

    /** 门铃声：三组「叮-咚」，前后隔开，响亮但不刺耳。 */
    function playChime() {
      unlockAudio();
      if (!audioCtx || audioCtx.state !== 'running') return;
      const t0 = audioCtx.currentTime + 0.05;
      const seq = [
        [523.25, 0], [783.99, 0.18],
        [523.25, 1.6], [783.99, 1.78],
        [659.25, 3.2], [880.0, 3.38]
      ];
      for (const [freq, offset] of seq) {
        try {
          tone(freq, t0 + offset, 0.5);
        } catch {
          /* 单个音失败不影响其余 */
        }
      }
    }

    // ── 计时状态仓库 ────────────────────────────────────────────────────────
    // 一个极简的「可订阅仓库」：组件用 React.useSyncExternalStore 订阅，
    // 每秒 tick 一次刷新倒计时显示；阶段切换在这里发生（单一事实来源）。

    /** 新一轮工作计时。lastPlanId 要带着走，保证不连续抽同一个计划。 */
    function freshWorkState(now, lastPlanId) {
      return {
        version: 1,
        phase: 'work',
        startedAt: now,
        deadline: now + WORK_SECONDS * 1000,
        planId: null,
        lastPlanId: lastPlanId ?? null,
        restSeconds: 0,
        alerted: false
      };
    }

    /**
     * 启动时读状态（ADR-004）：
     *   · sessionStorage 标记不在 → 整个 DSH 重启过 → 清掉旧状态，算新一轮；
     *   · 标记在（F5 刷新）→ 读 localStorage 接着算。
     */
    function loadInitialState() {
      const now = Date.now();
      let isNewSession = false;
      try {
        if (!sessionStorage.getItem(SESSION_KEY)) {
          isNewSession = true;
          sessionStorage.setItem(SESSION_KEY, String(now));
        }
      } catch {
        /* 存储不可用时当作新会话，至少能跑 */
        isNewSession = true;
      }
      if (isNewSession) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* 同上 */
        }
      }
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      } catch {
        saved = null;
      }
      if (
        saved &&
        saved.version === 1 &&
        typeof saved.deadline === 'number' &&
        typeof saved.startedAt === 'number' &&
        (saved.phase === 'work' || saved.phase === 'rest' || saved.phase === 'done')
      ) {
        return saved;
      }
      return freshWorkState(now, null);
    }

    /** 随机抽一个休息计划，不与上一个重复。 */
    function pickPlan(excludeId) {
      const pool = REST_PLANS.filter((plan) => plan.id !== excludeId);
      return pool[Math.floor(Math.random() * pool.length)];
    }

    /**
     * 建计时仓库。模块级单例：热更新/重复 apply 时先销毁旧实例，
     * 否则会出现「两个闹钟一起响」（ADR-010）。
     */
    function createClockStore() {
      const prev = window[STORE_SINGLETON_KEY];
      if (prev) {
        try {
          prev.dispose();
        } catch {
          /* 旧实例清理失败也要继续，不能带着两个计时器跑 */
        }
      }

      let state = loadInitialState();
      let now = Date.now();
      let snapshot = { state, now };
      const listeners = new Set();
      let intervalId = null;
      let flashTimer = null;
      let disposed = false;
      const originalTitle = typeof document !== 'undefined' ? document.title : '';

      /** 通知所有订阅者（snapshot 只在变化时换新对象，React 才认）。 */
      function emit() {
        snapshot = { state, now };
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            /* 一个订阅者出错不拖累其它 */
          }
        }
      }

      /** 状态落盘。 */
      function persist() {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
          /* 写不进去就只靠内存，刷新会丢一轮，可接受 */
        }
      }

      /** 换状态 = 替换 + 落盘 + 通知。 */
      function setState(next) {
        state = next;
        persist();
        emit();
      }

      /** 开始窗口标题闪烁（🐣 与原标题交替），把最小化的用户叫回来。 */
      function startFlash() {
        if (flashTimer !== null || typeof document === 'undefined') return;
        let flip = false;
        flashTimer = setInterval(() => {
          flip = !flip;
          document.title = flip ? '🐣 起来动一动！' : originalTitle;
        }, 1000);
      }

      /** 停止闪烁并还原标题。 */
      function stopFlash() {
        if (flashTimer !== null) {
          clearInterval(flashTimer);
          flashTimer = null;
        }
        if (typeof document !== 'undefined' && document.title !== originalTitle) {
          document.title = originalTitle;
        }
      }

      /** 到点提醒：提示音 + 标题闪烁。同一次休息只提醒一回（alerted 落盘）。 */
      function alertUser() {
        if (state.alerted) return;
        playChime();
        startFlash();
        setState({ ...state, alerted: true });
      }

      /**
       * 每秒一次的心跳。全部用「现在 − deadline」现算，不数滴答：
       * 电脑睡醒后第一次 tick 就会发现超时（ADR-012）。
       */
      function tick() {
        if (disposed) return;
        now = Date.now();

        // 系统时间被往回拨了一大截：本轮作废，重新开始（ADR-002 的兜底）
        if (now < state.startedAt - 60000) {
          stopFlash();
          setState(freshWorkState(now, state.lastPlanId));
          return;
        }

        if (state.phase === 'work' && now >= state.deadline) {
          const plan = pickPlan(state.lastPlanId);
          const restMs = DEV_MODE ? DEV_REST_SECONDS * 1000 : plan.restMinutes * 60 * 1000;
          setState({
            version: 1,
            phase: 'rest',
            startedAt: now,
            deadline: now + restMs,
            planId: plan.id,
            lastPlanId: state.lastPlanId,
            restSeconds: Math.round(restMs / 1000),
            alerted: false
          });
          alertUser();
          return;
        }

        if (state.phase === 'rest' && now >= state.deadline) {
          stopFlash();
          setState({ ...state, phase: 'done', lastPlanId: state.planId });
          return;
        }

        emit();
      }

      /** 页面重新可见 → 立刻重算，不等下一拍（睡眠校准的关键）。 */
      function onVisibility() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick();
      }

      /** 窗口重新聚焦 → 人回来了，停止标题闪烁。 */
      function onFocus() {
        stopFlash();
      }

      const store = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() {
          return snapshot;
        },
        /** 休息结束 → 点「开始下一轮」。 */
        startNextRound() {
          setState(freshWorkState(Date.now(), state.lastPlanId));
        },
        /** 长按紧急跳过 → 直接当作休息结束（ADR-005 的后门）。 */
        skipRest() {
          if (state.phase !== 'rest') return;
          stopFlash();
          setState({ ...state, phase: 'done', lastPlanId: state.planId });
        },
        start() {
          if (intervalId !== null) return;
          intervalId = setInterval(tick, 1000);
          if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
            document.addEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
          tick();
        },
        dispose() {
          disposed = true;
          if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
          }
          stopFlash();
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
          listeners.clear();
          if (window[STORE_SINGLETON_KEY] === store) delete window[STORE_SINGLETON_KEY];
        }
      };

      window[STORE_SINGLETON_KEY] = store;
      return store;
    }

    /** 当前仓库（apply 里创建；组件渲染时它一定已存在）。 */
    let store = null;

    // ── 小工具 ──────────────────────────────────────────────────────────────
    /** 毫秒 → "mm:ss"。 */
    function formatMs(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    /** 按计划 id 查计划。 */
    function planOf(id) {
      return REST_PLANS.find((plan) => plan.id === id) ?? null;
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    // 幕布/卡片配色用一套固定的暖色（奶油黄 + 橘粉），深浅主题下都显眼；
    // 类名统一前缀 dsh-clock-，避免污染全局。
    function clockCss() {
      return [
        // 幕布：盖住整个 DSH 窗口，后面的东西点不到
        '.dsh-clock-backdrop{position:fixed;inset:0;z-index:1000;display:flex;',
        'align-items:center;justify-content:center;padding:24px;',
        'background:rgba(24,18,10,.55);backdrop-filter:blur(2px);}',

        // 卡片：软糖质感 —— 大圆角、奶油底、暖色描边
        '.dsh-clock-card{box-sizing:border-box;display:flex;flex-direction:column;',
        'align-items:center;gap:14px;width:100%;max-width:460px;padding:34px 36px 26px;',
        'background:#fff6e5;border:3px solid #ffd9a0;border-radius:24px;',
        'box-shadow:0 18px 60px rgba(120,60,0,.35);color:#5b3a1a;text-align:center;}',

        // 弹出动画：「啵」地弹出来（缩放 + 一点回弹）
        '@keyframes dsh-clock-pop{0%{transform:scale(.6);opacity:0}',
        '70%{transform:scale(1.05);opacity:1}100%{transform:scale(1)}}',
        '.dsh-clock-pop{animation:dsh-clock-pop .45s cubic-bezier(.34,1.56,.64,1) both;}',

        // 小鸡轻轻跳
        '@keyframes dsh-clock-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
        '.dsh-clock-chick{font-size:56px;line-height:1;animation:dsh-clock-bounce 1.6s ease-in-out infinite;}',

        '.dsh-clock-title{font-size:28px;font-weight:700;letter-spacing:.04em;color:#d9601a;}',
        '.dsh-clock-task{font-size:34px;font-weight:700;color:#8a4b12;}',
        '.dsh-clock-detail{font-size:17px;line-height:26px;color:#9a6a33;}',

        // 大倒计时
        '.dsh-clock-count{font-size:56px;font-weight:800;font-variant-numeric:tabular-nums;',
        'letter-spacing:.03em;color:#d9601a;}',
        // 最后 10 秒：变红 + 心跳
        '@keyframes dsh-clock-heart{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
        '.dsh-clock-count-urgent{color:#e23b2e;animation:dsh-clock-heart 1s ease-in-out infinite;}',

        // 进度条
        '.dsh-clock-bar{box-sizing:border-box;width:100%;height:14px;border-radius:999px;',
        'background:#f3e2c2;border:1.5px solid #ffd9a0;overflow:hidden;}',
        '.dsh-clock-bar-fill{height:100%;border-radius:999px;',
        'background:linear-gradient(90deg,#ffb35c,#ff8a5c);transition:width .5s linear;}',
        '.dsh-clock-pct{font-size:13px;color:#b3854d;}',

        // 主按钮
        '.dsh-clock-done-btn{font:inherit;font-size:19px;font-weight:700;cursor:pointer;',
        'padding:12px 34px;border:0;border-radius:999px;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);',
        'box-shadow:0 6px 18px rgba(240,106,90,.4);}',
        '.dsh-clock-done-btn:hover{filter:brightness(1.06);}',
        '.dsh-clock-done-btn:disabled{cursor:not-allowed;filter:grayscale(.6);opacity:.55;',
        'box-shadow:none;}',

        // 长按紧急跳过
        '.dsh-clock-skip{position:relative;font:inherit;font-size:12.5px;cursor:pointer;',
        'padding:7px 16px;border-radius:999px;color:#b3854d;background:0 0;',
        'border:1.5px dashed #e3c491;overflow:hidden;user-select:none;',
        '-webkit-user-select:none;touch-action:none;}',
        '.dsh-clock-skip-fill{position:absolute;inset:0;background:rgba(240,106,90,.25);',
        'transform-origin:left center;pointer-events:none;}',
        '.dsh-clock-skip-label{position:relative;}',

        // 颜文字小彩蛋
        '.dsh-clock-kaomoji{font-size:13px;color:#c99a5b;}',

        // 侧栏底部入口按钮（尺寸照抄 dsh-work-diary 的同类按钮）
        '.dsh-clock-open{box-sizing:border-box;display:flex;align-items:center;gap:8px;',
        'height:42px;width:calc(100% + 4px);margin:0 -2px;padding:0 10px 0 8px;',
        'font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden;',
        'color:var(--dsw-alias-label-primary);background:0 0;border:0;',
        'border-radius:12px;text-align:left;}',
        '.dsh-clock-open:hover{background:var(--dsw-alias-interactive-bg-hover);}',
        '.dsh-clock-open-rail{width:36px;height:36px;margin:0;padding:0;gap:0;flex:none;',
        'border-radius:50%;justify-content:center;}',
        '.dsh-clock-open-icon{flex:none;font-size:17px;line-height:1;}',
        '.dsh-clock-open-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;',
        'text-overflow:ellipsis;font-variant-numeric:tabular-nums;}'
      ].join('');
    }

    /** 确保样式表存在。 */
    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = clockCss();
      document.head.appendChild(style);
    }

    // ── 组件 ────────────────────────────────────────────────────────────────

    /** 订阅仓库的 Hook（store 为空时返回 null，组件渲染前 store 一定已建好）。 */
    function useClock() {
      if (!store) return null;
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    /**
     * 长按 3 秒紧急跳过（ADR-005）。
     * 按住时虚线框里有一道进度色带从左推到右，走完才生效；中途松手归零。
     */
    function SkipButton(props) {
      const [holdPct, setHoldPct] = React.useState(0);
      const rafRef = React.useRef(0);
      const startRef = React.useRef(0);

      const cancel = React.useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        setHoldPct(0);
      }, []);

      React.useEffect(() => cancel, [cancel]);

      const step = React.useCallback(() => {
        const pct = Math.min(100, ((Date.now() - startRef.current) / SKIP_HOLD_MS) * 100);
        setHoldPct(pct);
        if (pct >= 100) {
          rafRef.current = 0;
          setHoldPct(0);
          props.onSkip();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      }, [props]);

      const begin = React.useCallback(
        (event) => {
          event.preventDefault();
          startRef.current = Date.now();
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(step);
        },
        [step]
      );

      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-clock-skip',
          title: '有急事？按住不放 3 秒可以跳过这次休息',
          'aria-label': '长按 3 秒紧急跳过本次休息',
          onPointerDown: begin,
          onPointerUp: cancel,
          onPointerLeave: cancel,
          onPointerCancel: cancel,
          onContextMenu: (event) => event.preventDefault()
        },
        React.createElement('span', {
          className: 'dsh-clock-skip-fill',
          style: { transform: `scaleX(${holdPct / 100})` }
        }),
        React.createElement(
          'span',
          { className: 'dsh-clock-skip-label' },
          holdPct > 0 ? `再按住 ${(Math.ceil((SKIP_HOLD_MS * (100 - holdPct)) / 100 / 100) / 10).toFixed(1)} 秒…` : '长按这里 3 秒可紧急跳过'
        )
      );
    }

    /** 休息中的卡片：任务 + 大倒计时 + 进度条 + 灰按钮 + 紧急跳过。 */
    function RestCard(props) {
      const remainingMs = Math.max(0, props.deadline - props.now);
      const totalMs = Math.max(1, props.restSeconds * 1000);
      const pct = Math.min(100, Math.round((1 - remainingMs / totalMs) * 100));
      const urgent = remainingMs <= 10000 && remainingMs > 0;

      return React.createElement(
        'div',
        { className: 'dsh-clock-card dsh-clock-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': '休息时间到' },
        React.createElement('div', { className: 'dsh-clock-chick' }, '🐣'),
        React.createElement('div', { className: 'dsh-clock-title' }, '✨ 起来动一动！✨'),
        React.createElement('div', { className: 'dsh-clock-task' }, `${props.plan.emoji} ${props.plan.title}`),
        React.createElement('div', { className: 'dsh-clock-detail' }, props.plan.detail),
        React.createElement(
          'div',
          { className: `dsh-clock-count${urgent ? ' dsh-clock-count-urgent' : ''}` },
          `⏰ ${formatMs(remainingMs)}`
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${pct}%` } })
        ),
        React.createElement('div', { className: 'dsh-clock-pct' }, `${pct}%`),
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-done-btn', disabled: true, title: '倒计时走完就能点啦' },
          '我休息好啦'
        ),
        React.createElement(SkipButton, { onSkip: props.onSkip })
      );
    }

    /** 休息结束的卡片：🎉 + 开始下一轮。 */
    function DoneCard(props) {
      return React.createElement(
        'div',
        { className: 'dsh-clock-card dsh-clock-pop', role: 'dialog', 'aria-modal': 'true', 'aria-label': '休息结束' },
        React.createElement('div', { className: 'dsh-clock-chick' }, '🎉'),
        React.createElement('div', { className: 'dsh-clock-title' }, '休息好啦！'),
        React.createElement(
          'div',
          { className: 'dsh-clock-detail' },
          props.plan ? `你刚刚完成了「${props.plan.title}」，真棒` : '这一轮休息结束啦，真棒'
        ),
        React.createElement('div', { className: 'dsh-clock-kaomoji' }, '(๑•̀ㅂ•́)و✧'),
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-done-btn', onClick: props.onNext },
          '开始下一轮'
        )
      );
    }

    /**
     * 浮层本体（挂在 shell.overlay）。
     * 工作中渲染 null —— 什么都不多；休息/结束时渲染幕布 + 卡片。
     */
    function ClockOverlay() {
      const snap = useClock();
      if (!snap) return null;
      const st = snap.state;
      if (st.phase === 'work') return null;
      const plan = planOf(st.planId);

      return React.createElement(
        'div',
        { className: 'dsh-clock-backdrop' },
        st.phase === 'rest' && plan
          ? React.createElement(RestCard, {
              plan,
              deadline: st.deadline,
              now: snap.now,
              restSeconds: st.restSeconds,
              onSkip: () => store.skipRest()
            })
          : React.createElement(DoneCard, { plan, onNext: () => store.startNextRound() })
      );
    }

    /**
     * 侧栏底部的常驻入口：🐣 + 倒计时。
     * 工作中显示还剩几分钟；休息中显示 ❗。点它不动什么（本版没有设置页），
     * 只是让「它活着」能一眼看到（路线图第 1 步的验收点）。
     */
    function ClockFooterButton(props) {
      const wide = props?.wide === true;
      const snap = useClock();
      let text = '健康钟';
      let icon = '🐣';
      if (snap) {
        const st = snap.state;
        if (st.phase === 'work') {
          text = `健康钟 ${formatMs(st.deadline - snap.now)}`;
        } else if (st.phase === 'rest') {
          text = `休息中 ${formatMs(st.deadline - snap.now)}`;
          icon = '⏰';
        } else {
          text = '休息好啦！';
          icon = '🎉';
        }
      }
      return React.createElement(
        'button',
        {
          type: 'button',
          className: `dsh-clock-open${wide ? '' : ' dsh-clock-open-rail'}`,
          title: `健康钟 v${CLIENT_VERSION}（每 ${DEV_MODE ? '2 分钟（测试模式）' : '45 分钟'} 提醒你休息一次）`,
          'aria-label': '健康钟',
          onClick: () => {}
        },
        React.createElement('span', { className: 'dsh-clock-open-icon' }, icon),
        wide ? React.createElement('span', { className: 'dsh-clock-open-label' }, text) : null
      );
    }

    // ── 注册 ────────────────────────────────────────────────────────────────
    /** 本插件依赖的客户端服务。slots 是硬依赖。 */
    const inject = ['slots'];

    /**
     * 客户端插件入口：①建计时仓库 ②注册 shell.overlay 浮层 ③注册侧栏入口按钮。
     * 全部清理都挂在 ctx.effect 下，插件卸载/热更新时自动撤掉（ADR-010）。
     *
     * @param ctx - 客户端 cordis 上下文
     */
    function apply(ctx) {
      ensureStyle();
      store = createClockStore();
      store.start();

      // ① 弹窗浮层（shell.overlay 是 list 型槽位，工作在时渲染 null）
      const disposeOverlay = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-clock', order: 100, label: '健康钟' },
          () => React.createElement(ClockOverlay, null)
        )
      );

      // ② 侧栏底部入口（让你一眼看到它还活着、还剩几分钟）
      const disposeFooter = ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-clock', order: 30, label: '健康钟' },
          (slotProps) => React.createElement(ClockFooterButton, { ...slotProps })
        )
      );

      ctx.effect(
        () => () => {
          for (const dispose of [disposeOverlay, disposeFooter]) {
            try {
              if (typeof dispose === 'function') dispose();
            } catch {
              /* 逐项清理，一项失败不影响其余 */
            }
          }
          if (store) {
            try {
              store.dispose();
            } catch {
              /* 同上 */
            }
            store = null;
          }
          if (typeof document !== 'undefined') {
            const style = document.getElementById(STYLE_ID);
            if (style) style.remove();
          }
        },
        'dsh-clock: 清理浮层、入口按钮与计时器'
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.CLIENT_VERSION = CLIENT_VERSION;
    exports.REST_PLANS = REST_PLANS;
    exports.formatMs = formatMs;

    return module.exports;
  }
});
