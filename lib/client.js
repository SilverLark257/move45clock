/**
 * DSH 健康钟插件 —— 浏览器半边（Client half）
 * ============================================================================
 *
 * 第 3 轮改判：计时不再放在浏览器里，而是由宿主（lib/index.js）负责。
 * 原因：DSH 最小化到托盘后，隐藏窗口里的定时器会被 Chromium 节流，弹窗也画在
 * 看不见的窗口里 —— 用户看到的现象就是「完全没弹窗」。
 *
 * 现在的分工：
 *   · 宿主：计时、切状态、到点用 PowerShell 把窗口叫回前台；
 *   · 浏览器：每秒拉一次状态，画悬浮卡片 / 左下角入口 / 详情面板，播放提示音。
 *
 * 页面刷新不会丢进度（状态在宿主内存里）；彻底重启 DSH 才重新开始。
 */

window.__ModuleLoader__.load({
  id: 'dsh-clock',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');

    // ── 常量 ────────────────────────────────────────────────────────────────
    /** 与宿主 lib/index.js 的 API_PREFIX 必须一致。 */
    const API = '/dsh-clock/rpc';

    /** 客户端版本标记。改本文件时 +1，便于确认浏览器里跑的是新包。 */
    const CLIENT_VERSION = '0.2.0';

    /** 样式表元素 id，卸载时按它清理。 */
    const STYLE_ID = 'dsh-clock-style';

    /** 模块级单例挂在 window 上的键（热更新时清掉旧实例）。 */
    const STORE_KEY = '__dshClockStore__';

    /** 长按紧急跳过需要的时长。 */
    const SKIP_HOLD_MS = 3000;

    /** 拉状态的间隔（毫秒）。倒计时的秒数在本地走，不需要每次拉。 */
    const POLL_MS = 2000;

    /**
     * 「更多功能」的预留入口。
     * 第 3 轮先占位，后面往里加功能时：在这里加一条 + 写对应的面板/弹窗即可。
     */
    const FUTURE_FEATURES = [
      { id: 'stats', icon: '📊', label: '统计与连续天数', hint: '即将上线' },
      { id: 'custom', icon: '🧩', label: '自定义休息计划', hint: '即将上线' },
      { id: 'sound', icon: '🔔', label: '提示音与音量', hint: '即将上线' }
    ];

    // ── 提示音 ──────────────────────────────────────────────────────────────
    // Web Audio 不需要授权；但浏览器自动播放策略要求「用户先和页面交互过」，
    // 所以在每次 pointerdown 时顺手解锁一次 AudioContext。
    let audioCtx = null;

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

    // ── 小工具 ──────────────────────────────────────────────────────────────
    function formatMs(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function formatClock(ts) {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function phaseLabel(phase) {
      if (phase === 'rest') return '休息中';
      if (phase === 'done') return '休息结束';
      return '工作中';
    }

    /** 请求宿主 API。失败抛错，由调用方决定怎么提示。 */
    async function request(path, init) {
      const res = await fetch(API + path, { cache: 'no-store', ...init });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.ok !== true) {
        const message = data && data.error ? data.error : `HTTP ${res.status}`;
        throw new Error(message);
      }
      return data;
    }

    // ── 计时仓库（只镜像宿主状态）────────────────────────────────────────────
    function createClockStore() {
      const prev = window[STORE_KEY];
      if (prev) {
        try {
          prev.dispose();
        } catch {
          /* 旧实例清理失败也要继续 */
        }
      }

      let snapshot = {
        state: null,
        now: Date.now(),
        offset: 0,
        connected: false,
        error: null
      };
      const listeners = new Set();
      let pollTimer = null;
      let tickTimer = null;
      let disposed = false;
      let lastPhase = null;
      let flashTimer = null;
      let flashBase = '';

      function emit() {
        snapshot = { ...snapshot, now: Date.now() + snapshot.offset };
        for (const listener of listeners) {
          try {
            listener();
          } catch {
            /* 一个订阅者出错不拖累其它 */
          }
        }
      }

      /** 窗口标题闪烁，把最小化的用户叫回来（任务栏原生闪烁插件做不到）。 */
      function startFlash() {
        if (flashTimer !== null || typeof document === 'undefined') return;
        flashBase = document.title;
        let flip = false;
        flashTimer = setInterval(() => {
          flip = !flip;
          document.title = flip ? '🐣 起来动一动！' : flashBase;
        }, 1000);
      }

      function stopFlash() {
        if (flashTimer !== null) {
          clearInterval(flashTimer);
          flashTimer = null;
        }
        if (typeof document !== 'undefined' && document.title.startsWith('🐣')) {
          document.title = flashBase;
        }
      }

      /** 把宿主返回的状态装进快照。 */
      function applyState(state, serverNow) {
        if (!state) return;
        if (typeof serverNow === 'number') snapshot.offset = serverNow - Date.now();
        const prevPhase = lastPhase;
        snapshot.state = state;
        snapshot.connected = true;
        snapshot.error = null;

        if (prevPhase !== null && prevPhase !== state.phase) {
          if (state.phase === 'rest') {
            playChime();
            // 窗口已经被宿主叫到前台时不用再闪标题；只在没有焦点时闪。
            if (typeof document === 'undefined' || !document.hasFocus()) startFlash();
          } else if (state.phase === 'done' || state.phase === 'work') {
            stopFlash();
          }
        }
        lastPhase = state.phase;
        emit();
      }

      async function refresh() {
        if (disposed) return;
        try {
          const data = await request('/state');
          if (disposed) return;
          applyState(data.state, data.state?.now);
        } catch (error) {
          if (disposed) return;
          snapshot.connected = false;
          snapshot.error = String(error?.message ?? error);
          emit();
        }
      }

      async function post(path) {
        try {
          const data = await request(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}'
          });
          if (data.state) applyState(data.state, data.state.now);
          return data;
        } catch (error) {
          snapshot.connected = false;
          snapshot.error = String(error?.message ?? error);
          emit();
          return null;
        }
      }

      function onVisibility() {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          stopFlash();
          refresh();
        }
      }

      function onFocus() {
        stopFlash();
        refresh();
      }

      const store = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot() {
          return snapshot;
        },
        refresh,
        start() {
          if (pollTimer !== null) return;
          pollTimer = setInterval(refresh, POLL_MS);
          tickTimer = setInterval(emit, 1000);
          if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
            document.addEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
          refresh();
        },
        dispose() {
          disposed = true;
          if (pollTimer !== null) clearInterval(pollTimer);
          if (tickTimer !== null) clearInterval(tickTimer);
          pollTimer = null;
          tickTimer = null;
          stopFlash();
          if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility);
            document.removeEventListener('pointerdown', unlockAudio);
          }
          if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
          listeners.clear();
          if (window[STORE_KEY] === store) delete window[STORE_KEY];
        },
        startRestNow: () => post('/rest'),
        skipRest: () => post('/skip'),
        startNextRound: () => post('/next'),
        reset: () => post('/reset'),
        testWake: () => post('/wake')
      };

      window[STORE_KEY] = store;
      return store;
    }

    /** 当前仓库（apply 里创建；组件渲染时它一定已存在）。 */
    let store = null;

    function useClock() {
      if (!store) return null;
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    // ── 样式 ────────────────────────────────────────────────────────────────
    function clockCss() {
      return [
        // 幕布：盖住整个 DSH 窗口，后面的东西点不到
        '.dsh-clock-backdrop{position:fixed;inset:0;z-index:1000;display:flex;',
        'align-items:center;justify-content:center;padding:24px;',
        'background:rgba(24,18,10,.55);backdrop-filter:blur(2px);}',

        // 卡片：软糖质感
        '.dsh-clock-card{box-sizing:border-box;display:flex;flex-direction:column;',
        'align-items:center;gap:14px;width:100%;max-width:460px;padding:34px 36px 26px;',
        'background:#fff6e5;border:3px solid #ffd9a0;border-radius:24px;',
        'box-shadow:0 18px 60px rgba(120,60,0,.35);color:#5b3a1a;text-align:center;}',

        '@keyframes dsh-clock-pop{0%{transform:scale(.6);opacity:0}',
        '70%{transform:scale(1.05);opacity:1}100%{transform:scale(1)}}',
        '.dsh-clock-pop{animation:dsh-clock-pop .45s cubic-bezier(.34,1.56,.64,1) both;}',

        '@keyframes dsh-clock-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}',
        '.dsh-clock-chick{font-size:56px;line-height:1;animation:dsh-clock-bounce 1.6s ease-in-out infinite;}',

        '.dsh-clock-title{font-size:28px;font-weight:700;letter-spacing:.04em;color:#d9601a;}',
        '.dsh-clock-task{font-size:34px;font-weight:700;color:#8a4b12;}',
        '.dsh-clock-detail{font-size:17px;line-height:26px;color:#9a6a33;}',

        '.dsh-clock-count{font-size:56px;font-weight:800;font-variant-numeric:tabular-nums;',
        'letter-spacing:.03em;color:#d9601a;}',
        '@keyframes dsh-clock-heart{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
        '.dsh-clock-count-urgent{color:#e23b2e;animation:dsh-clock-heart 1s ease-in-out infinite;}',

        '.dsh-clock-bar{box-sizing:border-box;width:100%;height:14px;border-radius:999px;',
        'background:#f3e2c2;border:1.5px solid #ffd9a0;overflow:hidden;}',
        '.dsh-clock-bar-fill{height:100%;border-radius:999px;',
        'background:linear-gradient(90deg,#ffb35c,#ff8a5c);transition:width .5s linear;}',
        '.dsh-clock-pct{font-size:13px;color:#b3854d;}',

        '.dsh-clock-done-btn{font:inherit;font-size:19px;font-weight:700;cursor:pointer;',
        'padding:12px 34px;border:0;border-radius:999px;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);',
        'box-shadow:0 6px 18px rgba(240,106,90,.4);}',
        '.dsh-clock-done-btn:hover{filter:brightness(1.06);}',
        '.dsh-clock-done-btn:disabled{cursor:not-allowed;filter:grayscale(.6);opacity:.55;',
        'box-shadow:none;}',

        '.dsh-clock-skip{position:relative;font:inherit;font-size:12.5px;cursor:pointer;',
        'padding:7px 16px;border-radius:999px;color:#b3854d;background:0 0;',
        'border:1.5px dashed #e3c491;overflow:hidden;user-select:none;',
        '-webkit-user-select:none;touch-action:none;}',
        '.dsh-clock-skip-fill{position:absolute;inset:0;background:rgba(240,106,90,.25);',
        'transform-origin:left center;pointer-events:none;}',
        '.dsh-clock-skip-label{position:relative;}',
        '.dsh-clock-kaomoji{font-size:13px;color:#c99a5b;}',

        // 左下角入口
        '.dsh-clock-open{box-sizing:border-box;display:flex;align-items:center;gap:8px;',
        'height:42px;width:calc(100% + 4px);margin:0 -2px;padding:0 10px 0 8px;',
        'font-family:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden;',
        'color:var(--dsw-alias-label-primary);background:0 0;border:0;',
        'border-radius:12px;text-align:left;}',
        '.dsh-clock-open:hover{background:var(--dsw-alias-interactive-bg-hover);}',
        '.dsh-clock-open[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover);}',
        '.dsh-clock-open-rail{width:36px;height:36px;margin:0;padding:0;gap:0;flex:none;',
        'border-radius:50%;justify-content:center;}',
        '.dsh-clock-open-icon{flex:none;font-size:17px;line-height:1;}',
        '.dsh-clock-open-label{flex:1;min-width:0;overflow:hidden;white-space:nowrap;',
        'text-overflow:ellipsis;font-variant-numeric:tabular-nums;}',
        '.dsh-clock-open[data-offline="true"] .dsh-clock-open-label{color:#c0392b;}',

        // 详情面板
        '.dsh-clock-panel{position:fixed;left:12px;bottom:64px;width:312px;',
        'max-width:calc(100vw - 24px);z-index:1200;box-sizing:border-box;padding:16px;',
        'border-radius:18px;background:#fff6e5;border:2px solid #ffd9a0;',
        'box-shadow:0 18px 50px rgba(120,60,0,.35);color:#5b3a1a;font-size:14px;',
        'line-height:1.5;}',
        '.dsh-clock-panel-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;}',
        '.dsh-clock-panel-title{font-size:16px;font-weight:800;color:#d9601a;flex:1;}',
        '.dsh-clock-panel-close{border:0;background:0 0;font-size:18px;line-height:1;',
        'cursor:pointer;color:#b3854d;padding:2px 6px;border-radius:8px;}',
        '.dsh-clock-panel-close:hover{background:rgba(255,217,160,.5);}',
        '.dsh-clock-panel-big{font-size:34px;font-weight:800;font-variant-numeric:tabular-nums;',
        'color:#d9601a;text-align:center;margin:2px 0 6px;}',
        '.dsh-clock-panel-row{display:flex;justify-content:space-between;gap:10px;',
        'font-size:13px;color:#8a6238;margin:3px 0;}',
        '.dsh-clock-panel-row b{font-weight:700;color:#6b451f;}',
        '.dsh-clock-panel-sep{height:1px;background:#f0d9b5;margin:12px 0;}',
        '.dsh-clock-panel-actions{display:flex;gap:8px;flex-wrap:wrap;}',
        '.dsh-clock-panel-btn{font:inherit;font-size:13px;font-weight:700;cursor:pointer;',
        'padding:8px 14px;border-radius:999px;border:0;color:#fff;',
        'background:linear-gradient(135deg,#ff9a4d,#f06a8a);}',
        '.dsh-clock-panel-btn.ghost{background:#fff;border:1.5px solid #ffd9a0;color:#a8601f;}',
        '.dsh-clock-panel-btn:disabled{opacity:.5;cursor:default;}',
        '.dsh-clock-panel-note{font-size:11.5px;color:#b3854d;margin-top:8px;}',
        '.dsh-clock-future{display:flex;flex-direction:column;gap:4px;}',
        '.dsh-clock-future-item{display:flex;align-items:center;gap:8px;width:100%;',
        'border:0;font:inherit;text-align:left;cursor:pointer;',
        'padding:6px 8px;border-radius:10px;background:rgba(255,217,160,.25);',
        'color:#a07340;font-size:12.5px;}',
        '.dsh-clock-future-item:hover{background:rgba(255,217,160,.45);}',
        '.dsh-clock-future-item em{margin-left:auto;font-style:normal;opacity:.7;}'
      ].join('');
    }

    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = clockCss();
      document.head.appendChild(style);
    }

    // ── 组件 ────────────────────────────────────────────────────────────────

    /** 长按 3 秒紧急跳过。 */
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
          holdPct > 0
            ? `再按住 ${(Math.ceil((SKIP_HOLD_MS * (100 - holdPct)) / 100 / 100) / 10).toFixed(1)} 秒…`
            : '长按这里 3 秒可紧急跳过'
        )
      );
    }

    /** 休息中的卡片。 */
    function RestCard(props) {
      const remainingMs = Math.max(0, props.deadline - props.now);
      const totalMs = Math.max(1, props.restSeconds * 1000);
      const pct = Math.min(100, Math.round((1 - remainingMs / totalMs) * 100));
      const urgent = remainingMs <= 10000 && remainingMs > 0;

      return React.createElement(
        'div',
        {
          className: 'dsh-clock-card dsh-clock-pop',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '休息时间到'
        },
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
          {
            className: 'dsh-clock-bar',
            role: 'progressbar',
            'aria-valuenow': pct,
            'aria-valuemin': 0,
            'aria-valuemax': 100
          },
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

    /** 休息结束的卡片。 */
    function DoneCard(props) {
      return React.createElement(
        'div',
        {
          className: 'dsh-clock-card dsh-clock-pop',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '休息结束'
        },
        React.createElement('div', { className: 'dsh-clock-chick' }, '🎉'),
        React.createElement('div', { className: 'dsh-clock-title' }, '休息好啦！'),
        React.createElement(
          'div',
          { className: 'dsh-clock-detail' },
          props.skipped
            ? '这次先跳过啦，下次记得补上 (๑•̀ㅂ•́)و✧'
            : props.plan
              ? `你刚刚完成了「${props.plan.title}」，真棒`
              : '这一轮休息结束啦，真棒'
        ),
        React.createElement('div', { className: 'dsh-clock-kaomoji' }, '(๑•̀ㅂ•́)و✧'),
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-done-btn', onClick: props.onNext },
          '开始下一轮'
        )
      );
    }

    /** 浮层本体（挂在 shell.overlay）。工作中返回 null。 */
    function ClockOverlay() {
      const snap = useClock();
      if (!snap || !snap.state) return null;
      const state = snap.state;
      if (state.phase === 'work') return null;

      const plan = state.plan;
      return React.createElement(
        'div',
        { className: 'dsh-clock-backdrop' },
        state.phase === 'rest' && plan
          ? React.createElement(RestCard, {
              plan,
              deadline: state.deadline,
              now: snap.now,
              restSeconds: state.restSeconds,
              onSkip: () => store.skipRest()
            })
          : React.createElement(DoneCard, {
              plan,
              skipped: Boolean(state.skipped),
              onNext: () => store.startNextRound()
            })
      );
    }

    /** 左下角详情面板。 */
    function ClockPanel(props) {
      const { snap, onClose } = props;
      const state = snap.state;
      const [pending, setPending] = React.useState(null);

      const head = React.createElement(
        'div',
        { className: 'dsh-clock-panel-head' },
        React.createElement('span', { className: 'dsh-clock-panel-title' }, '🐣 健康钟'),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-clock-panel-close',
            onClick: onClose,
            'aria-label': '关闭详情'
          },
          '×'
        )
      );

      if (!state) {
        return React.createElement(
          'div',
          { className: 'dsh-clock-panel', role: 'dialog', 'aria-label': '健康钟详情' },
          head,
          React.createElement(
            'div',
            { className: 'dsh-clock-panel-note' },
            snap.connected
              ? '正在读取状态…'
              : '连不上宿主。请完全退出 DSH 再打开（宿主半边要重启才加载）。'
          ),
          snap.error ? React.createElement('div', { className: 'dsh-clock-panel-row' }, snap.error) : null
        );
      }

      const remaining = Math.max(0, state.deadline - snap.now);
      const isRest = state.phase === 'rest';
      const isWork = state.phase === 'work';
      const isDone = state.phase === 'done';
      const workMs = (state.workSeconds ?? 0) * 1000;
      const elapsedPct =
        isWork && workMs > 0
          ? Math.min(100, Math.round(((snap.now - state.startedAt) / workMs) * 100))
          : 0;
      const restPct =
        isRest && state.restSeconds > 0
          ? Math.min(100, Math.round((1 - remaining / (state.restSeconds * 1000)) * 100))
          : 0;
      const pct = isWork ? elapsedPct : isRest ? restPct : 100;

      const rows = [
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'phase' },
          React.createElement('span', null, '状态'),
          React.createElement('b', null, phaseLabel(state.phase))
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'next' },
          React.createElement('span', null, isWork ? '下次提醒' : isRest ? '休息结束' : '下一轮'),
          React.createElement('b', null, isDone ? '点按钮开始' : formatClock(state.deadline))
        ),
        React.createElement(
          'div',
          { className: 'dsh-clock-panel-row', key: 'count' },
          React.createElement('span', null, '今天完成'),
          React.createElement('b', null, `${state.doneCount ?? 0} 次`)
        )
      ];

      if (state.plan) {
        rows.push(
          React.createElement(
            'div',
            { className: 'dsh-clock-panel-row', key: 'plan' },
            React.createElement('span', null, '本次计划'),
            React.createElement('b', null, `${state.plan.emoji} ${state.plan.title}`)
          )
        );
      }

      const actions = [];
      if (isWork) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn', key: 'rest', onClick: props.onRestNow },
            '现在休息一下'
          )
        );
      }
      if (isDone) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn', key: 'next', onClick: props.onNext },
            '开始下一轮'
          )
        );
      }
      actions.push(
        React.createElement(
          'button',
          { type: 'button', className: 'dsh-clock-panel-btn ghost', key: 'reset', onClick: props.onReset },
          '重新计时'
        )
      );
      if (props.devMode) {
        actions.push(
          React.createElement(
            'button',
            { type: 'button', className: 'dsh-clock-panel-btn ghost', key: 'wake', onClick: props.onWake },
            '测试提醒'
          )
        );
      }

      return React.createElement(
        'div',
        { className: 'dsh-clock-panel', role: 'dialog', 'aria-label': '健康钟详情' },
        head,
        React.createElement('div', { className: 'dsh-clock-panel-big' }, isDone ? '🎉' : formatMs(remaining)),
        React.createElement(
          'div',
          { className: 'dsh-clock-bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          React.createElement('div', { className: 'dsh-clock-bar-fill', style: { width: `${pct}%` } })
        ),
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        rows,
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        React.createElement('div', { className: 'dsh-clock-panel-actions' }, actions),
        isRest
          ? React.createElement(
              'div',
              { className: 'dsh-clock-panel-note' },
              '休息中：想提前结束，请长按卡片上的「紧急跳过」3 秒。'
            )
          : null,
        React.createElement('div', { className: 'dsh-clock-panel-sep' }),
        React.createElement(
          'div',
          { className: 'dsh-clock-future' },
          FUTURE_FEATURES.map((item) =>
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-clock-future-item',
                key: item.id,
                title: '这个入口先占个位，功能还在路上',
                onClick: () => setPending(item.label)
              },
              React.createElement('span', null, item.icon),
              React.createElement('span', null, item.label),
              React.createElement('em', null, item.hint)
            )
          )
        ),
        pending
          ? React.createElement(
              'div',
              { className: 'dsh-clock-panel-note' },
              `「${pending}」还在开发中，下个版本见 (๑•̀ㅂ•́)و✧`
            )
          : null
      );
    }

    /** 左下角入口 + 详情面板。 */
    function ClockFooterButton(props) {
      const wide = props?.wide === true;
      const snap = useClock();
      const [open, setOpen] = React.useState(false);
      const btnRef = React.useRef(null);
      const panelRef = React.useRef(null);

      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          if (panelRef.current && panelRef.current.contains(event.target)) return;
          if (btnRef.current && btnRef.current.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      // 进入休息 / 完成后自动收起面板，避免盖在幕布上。
      const phase = snap?.state?.phase;
      React.useEffect(() => {
        if (phase && phase !== 'work') setOpen(false);
      }, [phase]);

      const state = snap?.state;
      let text = '健康钟';
      let icon = '🐣';
      let offline = false;

      if (!snap || !state) {
        text = snap && snap.connected === false ? '健康钟 · 连接中' : '健康钟';
        if (snap && snap.connected === false && snap.error) {
          text = '健康钟 · 离线';
          offline = true;
        }
      } else if (state.phase === 'work') {
        text = `健康钟 ${formatMs(state.deadline - snap.now)}`;
      } else if (state.phase === 'rest') {
        text = `休息中 ${formatMs(state.deadline - snap.now)}`;
        icon = '⏰';
      } else {
        text = '休息好啦！';
        icon = '🎉';
      }

      const devMode = Boolean(state?.devMode);

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            ref: btnRef,
            className: `dsh-clock-open${wide ? '' : ' dsh-clock-open-rail'}`,
            title: `健康钟 v${CLIENT_VERSION}（点开看详情）`,
            'aria-label': '健康钟：点开看详情',
            'aria-expanded': open,
            'data-open': open ? 'true' : 'false',
            'data-offline': offline ? 'true' : 'false',
            onClick: () => setOpen((value) => !value)
          },
          React.createElement('span', { className: 'dsh-clock-open-icon' }, icon),
          wide ? React.createElement('span', { className: 'dsh-clock-open-label' }, text) : null
        ),
        open
          ? React.createElement(
              'div',
              { ref: panelRef },
              React.createElement(ClockPanel, {
                snap,
                onClose: () => setOpen(false),
                devMode,
                onRestNow: () => store.startRestNow(),
                onNext: () => store.startNextRound(),
                onReset: () => store.reset(),
                onWake: () => store.testWake()
              })
            )
          : null
      );
    }

    // ── 注册 ────────────────────────────────────────────────────────────────
    const inject = ['slots'];

    /**
     * 客户端插件入口：建仓库 → 注册浮层 → 注册左下角入口。
     * 所有清理都挂在 ctx.effect 下。
     */
    function apply(ctx) {
      ensureStyle();
      store = createClockStore();
      store.start();

      const disposeOverlay = ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-clock', order: 100, label: '健康钟' },
          () => React.createElement(ClockOverlay, null)
        )
      );

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
              /* 逐项清理 */
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
        'dsh-clock: 清理浮层、入口按钮与轮询'
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.CLIENT_VERSION = CLIENT_VERSION;

    return module.exports;
  }
});
