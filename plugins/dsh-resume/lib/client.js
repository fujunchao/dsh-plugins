/*
 * dsh-resume — 浏览器半。
 *
 * 会话被中断（报错/限流/进程退出/手动停止/输出截断）后，把输入框右下角那颗"灰掉的发送键"
 * 变成一颗可点的「▶ 继续」：点一下就让宿主把"续跑指令"排队、唤醒驱动，接着干。
 *
 * 关键取舍：
 *  - 宿主没有"替换发送键"的 slot，所以这里是**测量 + 精确覆盖**：找到卡片里最后一个
 *    button（发送键），按它的矩形把按钮画在同一个位置（portal 到 body、position:fixed），
 *    并复制它的背景色/文字色，做到"同一颗按钮变身"。测量失败自动降级到工具条按钮。
 *  - 只有宿主发送键处于 disabled（草稿为空/无可提交）且我们判定"这一轮被中断"时才出现，
 *    **永远不会盖住可用的发送键**；一开始打字，宿主键变可用，我们立即消失。
 *  - 万一点击落在"宿主键其实已经可用"的瞬间，把这一下点转交给宿主，不吞掉真正的发送。
 *
 * 零构建 bundle：window.__ModuleLoader__.load + CJS 体，只 require 平台种子模块。
 */
window.__ModuleLoader__.load({
  id: 'dsh-resume',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var reactDom = require('react-dom');
    var h = React.createElement;
    var createPortal =
      reactDom && typeof reactDom.createPortal === 'function'
        ? reactDom.createPortal
        : function (child) {
            return child;
          };

    /** Locale namespace owned by this plugin. */
    var NS = 'resume';
    var PLUGIN_ID = 'dsh-resume';
    var ROUTE = '/dsh-resume';
    /** 覆盖层 slot（落在 composer 卡片内部）。 */
    var OVERLAY_SLOT = 'conversation.input.overlay';
    /** 降级 slot（发送键左侧的工具条）。 */
    var TOOLBAR_SLOT = 'conversation.input.right';
    /** 卡片上由宿主提供的稳定标记。 */
    var CARD_ATTR = '[data-composer-card]';
    var OVERLAY_ATTR = '[data-composer-overlay]';

    // ------------------------------------------------------------------ 文案

    var zh = {
      title: '继续未完成的工作',
      hint: '直接输入文字即可忽略',
      sending: '正在继续…',
      'error.network': '没能把续跑指令发出去（网络错误）',
      'error.no-agent': '这个会话当前不在运行，无法继续',
      'error.busy': '会话正在运行',
      'error.queued': '已有排队中的消息，先让它跑完',
      'error.not-interrupted': '这一轮没有被中断',
      'error.stale': '会话已经变化，请重试',
      'error.in-flight': '上一次继续还没落定',
      'error.followup-failed': '入队失败',
      'error.generic': '没能继续：{code}',
      'cause.generic': '上次中断',
      'row.title': '上一轮被中断',
      'row.continue': '继续',
      'row.ignore': '忽略',
      'row.sending': '正在继续…',
      'row.stale': '这一轮不是当前中断点',
      'row.failed': '没能继续：{code}',
    };

    var en = {
      title: 'Continue unfinished work',
      hint: 'Type anything to dismiss',
      sending: 'Continuing…',
      'error.network': 'Could not send the continuation (network error)',
      'error.no-agent': 'This session is not running, so it cannot continue',
      'error.busy': 'The session is running',
      'error.queued': 'A message is already queued; let it run first',
      'error.not-interrupted': 'This turn was not interrupted',
      'error.stale': 'The session changed, please retry',
      'error.in-flight': 'The previous continue has not settled yet',
      'error.followup-failed': 'Could not queue the continuation',
      'error.generic': 'Could not continue: {code}',
      'cause.generic': 'interrupted',
      'row.title': 'Previous turn was interrupted',
      'row.continue': 'Continue',
      'row.ignore': 'Dismiss',
      'row.sending': 'Continuing…',
      'row.stale': 'Not the current interruption',
      'row.failed': 'Could not continue: {code}',
    };

    // ------------------------------------------------------------------ 样式

    var CSS = [
      '.rs-seat{position:fixed;z-index:40;border:none;border-radius:999px;display:grid;place-items:center;',
      'cursor:pointer;padding:0;margin:0;box-sizing:border-box;font:inherit;color:#fff;',
      'transition:filter .12s,transform .12s,opacity .12s;animation:rs-pop .14s ease-out;outline:none;',
      '-webkit-tap-highlight-color:transparent;}',
      '.rs-seat[data-phase="sending"]{cursor:progress;}',
      '@media (hover:hover){.rs-seat:hover{filter:brightness(1.08);}',
      '.rs-seat:hover .rs-glyph{transform:translateX(1px);}}',
      '.rs-seat:active{transform:scale(.96);}',
      '.rs-seat:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}',
      '.rs-glyph{display:block;transition:transform .12s;}',
      '.rs-inline{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;',
      'border:none;border-radius:999px;cursor:pointer;padding:0;color:#fff;background:var(--dsw-alias-brand-primary);',
      'transition:filter .12s,transform .12s;}',
      '.rs-inline:hover{filter:brightness(1.08);}',
      '.rs-inline:active{transform:scale(.96);}',
      '.rs-spin{animation:rs-rotate .9s linear infinite;transform-origin:50% 50%;}',
      '@keyframes rs-rotate{to{transform:rotate(360deg);}}',
      '@keyframes rs-pop{from{opacity:0;transform:scale(.92);}to{opacity:1;transform:scale(1);}}',
      '@media (prefers-reduced-motion:reduce){.rs-seat{animation:none;transition:none;}',
      '.rs-seat:active{transform:none;}.rs-glyph{transition:none;}.rs-spin{animation-duration:2s;}}',
      '.rs-tip{position:fixed;z-index:41;max-width:320px;padding:8px 10px;border-radius:8px;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);',
      'box-shadow:0 8px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);',
      'font-size:12px;line-height:18px;pointer-events:none;animation:rs-pop .12s ease-out;}',
      '.rs-tip-title{font-weight:600;}',
      '.rs-tip-cause{color:var(--dsw-alias-label-secondary);}',
      '.rs-tip-hint{color:var(--dsw-alias-label-secondary);opacity:.75;}',
      '.rs-tip-error{color:var(--dsw-alias-state-error-primary);}',
      '.rs-row{display:flex;align-items:center;gap:8px;margin:6px 0 2px;padding:6px 10px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);',
      'font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);',
      'max-width:var(--dsh-chat-content-width,748px);box-sizing:border-box;animation:rs-pop .14s ease-out;}',
      '.rs-row-glyph{display:inline-flex;flex:none;color:var(--dsw-alias-brand-primary);}',
      '.rs-row-text{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.rs-row-err{color:var(--dsw-alias-state-error-primary);}',
      '.rs-row-btn{flex:none;height:24px;padding:0 12px;border-radius:999px;font-size:12px;line-height:22px;',
      'border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);',
      'cursor:pointer;transition:filter .12s;}',
      '.rs-row-btn[data-primary="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;}',
      '.rs-row-btn:hover:not(:disabled){filter:brightness(1.06);}',
      '.rs-row-btn:disabled{opacity:.5;cursor:default;}',
    ].join('');

    var CSS_ID = PLUGIN_ID + '/resume.css';

    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return;
      var selector = 'style[data-plugin-css="' + CSS_ID + '"]';
      if (document.querySelector(selector) !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------ 降级模式（页面级）

    var mode = 'probing';
    var modeListeners = [];

    function setMode(next) {
      if (mode === next) return;
      mode = next;
      for (var i = 0; i < modeListeners.length; i += 1) modeListeners[i]();
    }

    function useMode() {
      var state = React.useState(mode);
      var value = state[0];
      var setValue = state[1];
      React.useEffect(function () {
        var listener = function () {
          setValue(mode);
        };
        modeListeners.push(listener);
        return function () {
          var index = modeListeners.indexOf(listener);
          if (index !== -1) modeListeners.splice(index, 1);
        };
      }, []);
      return value;
    }

    // ------------------------------------------------------------------ 状态请求

    /** 短缓存：overlay 与 toolbar 两个实例共用一次请求。 */
    var stateCache = { key: '', at: 0, value: null };

    /** 当前界面语言（用字典回读判定，避免依赖 locale 快照的字段名）。 */
    function languageTag(t) {
      try {
        return t('title') === zh.title ? 'zh' : 'en';
      } catch (error) {
        return 'en';
      }
    }

    function fetchState(sessionId, t) {
      var now = Date.now();
      var key = sessionId + ':' + languageTag(t);
      if (stateCache.key === key && now - stateCache.at < 1200) return Promise.resolve(stateCache.value);
      var url =
        ROUTE +
        '/state?sessionId=' +
        encodeURIComponent(sessionId) +
        '&lang=' +
        encodeURIComponent(languageTag(t));
      return fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (json) {
          var value = json && json.ok === true ? json : null;
          stateCache = { key: key, at: Date.now(), value: value };
          return value;
        })
        .catch(function () {
          return null;
        });
    }

    /**
     * 订阅某会话的中断状态。
     * 触发重取：会话切换、running 翻转（回合开始/结束）、窗口重新获得焦点。
     */
    function useResumeState(sessionId, running, t) {
      var infoState = React.useState(null);
      var info = infoState[0];
      var setInfo = infoState[1];
      var tickState = React.useState(0);
      var tick = tickState[0];
      var setTick = tickState[1];

      React.useEffect(
        function () {
          if (!sessionId) {
            setInfo(null);
            return undefined;
          }
          var cancelled = false;
          fetchState(sessionId, t).then(function (value) {
            if (!cancelled) setInfo(value);
          });
          return function () {
            cancelled = true;
          };
        },
        [sessionId, running, tick],
      );

      React.useEffect(function () {
        if (typeof window === 'undefined') return undefined;
        var onFocus = function () {
          setTick(function (n) {
            return n + 1;
          });
        };
        window.addEventListener('focus', onFocus);
        return function () {
          window.removeEventListener('focus', onFocus);
        };
      }, []);

      return [
        info,
        function refresh() {
          stateCache = { key: '', at: 0, value: null };
          setTick(function (n) {
            return n + 1;
          });
        },
      ];
    }

    function eligible(info, running) {
      if (!info || !info.state) return false;
      if (running === true) return false;
      return info.state.eligible === true;
    }

    function errorText(t, code) {
      var key = 'error.' + String(code || '');
      var translated = t(key);
      if (translated !== key) return translated;
      return t('error.generic', { code: code || 'unknown' });
    }

    // ------------------------------------------------------------------ 图标

    var PLAY_PATH =
      'M6.35 3.72c0-.68.74-1.1 1.33-.75l5.06 2.98c.58.34.58 1.18 0 1.52l-5.06 2.98c-.59.35-1.33-.07-1.33-.75V3.72Z';

    function PlayGlyph(props) {
      var size = props.size || 16;
      return h(
        'svg',
        {
          className: 'rs-glyph',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: 'false',
        },
        h('path', { d: PLAY_PATH, fill: 'currentColor' }),
      );
    }

    function SpinnerGlyph(props) {
      var size = props.size || 15;
      return h(
        'svg',
        {
          className: 'rs-glyph rs-spin',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: 'false',
        },
        h('circle', {
          cx: '8',
          cy: '8',
          r: '5.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.8',
          strokeLinecap: 'round',
          strokeDasharray: '10 22',
        }),
      );
    }

    // ------------------------------------------------------------------ 动作

    function useContinueAction(sessionId, info, refresh, t) {
      var phaseState = React.useState('idle');
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var messageState = React.useState(null);
      var message = messageState[0];
      var setMessage = messageState[1];
      var timerRef = React.useRef(0);

      React.useEffect(function () {
        return function () {
          if (timerRef.current) window.clearTimeout(timerRef.current);
        };
      }, []);

      function fail(code) {
        setPhase('idle');
        setMessage(errorText(t, code));
        refresh();
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(function () {
          setMessage(null);
        }, 5000);
      }

      function run() {
        if (phase === 'sending' || !sessionId) return;
        var state = info && info.state ? info.state : null;
        setPhase('sending');
        setMessage(null);
        var settled = false;
        postContinue(sessionId, state, t)
          .then(function (json) {
            settled = true;
            if (json && json.ok === true) {
              refresh();
              return;
            }
            fail((json && json.code) || 'unknown');
          })
          .catch(function () {
            settled = true;
            fail('network');
          });

        window.setTimeout(function () {
          if (settled) return;
          settled = true;
          setPhase('idle');
          setMessage(t('error.network'));
        }, 4000);
      }

      return { phase: phase, message: message, run: run };
    }

    // ------------------------------------------------------------------ 键位探测

    /**
     * 找宿主发送键：卡片里最后一个 button（宿主渲染顺序里它是 primary），
     * 用几何自检（尺寸 20–56、位于卡片右下象限）确认没找错。
     *
     * 返回：
     *   null                      → 这个挂载点根本不在卡片里（不改变全局形态）
     *   { hidden: true }          → 卡片没画出来（例如隐藏的侧边栏聊天），不参与判断
     *   { seat: null }            → 卡片在，但找不到/看不准发送键 → 该降级
     *   { seat, rect }            → 找到了
     */
    function probeSeat(anchorEl) {
      if (!anchorEl || !anchorEl.isConnected) return null;
      var card = anchorEl.closest(CARD_ATTR);
      if (card === null) {
        var wrapper = anchorEl.closest(OVERLAY_ATTR);
        card = wrapper !== null ? wrapper.parentElement : null;
      }
      if (card === null) return null;

      var cardRect = card.getBoundingClientRect();
      if (cardRect.width < 80 || cardRect.height < 40) return { card: card, hidden: true, seat: null, rect: null };

      var buttons = card.querySelectorAll('button');
      var seat = null;
      for (var i = buttons.length - 1; i >= 0; i -= 1) {
        var candidate = buttons[i];
        if (candidate.closest(OVERLAY_ATTR) !== null) continue;
        seat = candidate;
        break;
      }
      if (seat === null) return { card: card, hidden: false, seat: null, rect: null };

      var rect = seat.getBoundingClientRect();
      if (rect.width < 20 || rect.width > 56 || rect.height < 20 || rect.height > 56) {
        return { card: card, hidden: false, seat: null, rect: null };
      }
      if (rect.left < cardRect.left + cardRect.width * 0.5) return { card: card, hidden: false, seat: null, rect: null };
      if (rect.top < cardRect.top + cardRect.height * 0.5) return { card: card, hidden: false, seat: null, rect: null };

      return { card: card, hidden: false, seat: seat, rect: rect };
    }

    /** 复制键位本身的肤色，让覆盖层看起来就是同一颗按钮。 */
    function readSeatSkin(seat) {
      try {
        var style = window.getComputedStyle(seat);
        return { background: style.backgroundColor, color: style.color, radius: style.borderRadius };
      } catch (error) {
        return { background: 'var(--dsw-alias-brand-primary)', color: '#ffffff', radius: '999px' };
      }
    }

    // ------------------------------------------------------------------ 覆盖层控件

    function ResumeSeat(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var t = props.t;
      var running = typeof useSession === 'function' ? useSession(function (s) { return s.running; }) : undefined;

      var statePair = useResumeState(sessionId, running, t);
      var info = statePair[0];
      var refresh = statePair[1];
      var action = useContinueAction(sessionId, info, refresh, t);

      var anchorRef = React.useRef(null);
      var seatRef = React.useRef(null);
      var skinRef = React.useRef(null);
      var geometryState = React.useState(null);
      var geometry = geometryState[0];
      var setGeometry = geometryState[1];
      var skinState = React.useState(null);
      var skin = skinState[0];
      var setSkin = skinState[1];
      var hoverState = React.useState(false);
      var hovered = hoverState[0];
      var setHovered = hoverState[1];
      var modeValue = useMode();

      var placement = info && info.options && info.options.placement === 'toolbar' ? 'toolbar' : 'seat';
      var allowed = eligible(info, running);
      var show = allowed && placement === 'seat' && modeValue === 'seat' && geometry !== null;
      var seq = info && info.state ? info.state.seq : null;

      function applySkin(next) {
        if (next === null) return;
        var prev = skinRef.current;
        if (prev !== null && prev.background === next.background && prev.color === next.color && prev.radius === next.radius) return;
        skinRef.current = next;
        setSkin(next);
      }

      React.useEffect(
        function () {
          if (!sessionId || running === true) {
            setGeometry(null);
            seatRef.current = null;
            return undefined;
          }
          if (placement === 'toolbar') {
            setMode('toolbar');
            setGeometry(null);
            return undefined;
          }

          var stopped = false;
          var observer = null;
          var mutate = null;

          function tickOnce() {
            if (stopped) return;
            var probe = probeSeat(anchorRef.current);
            if (probe === null) {
              // 不在卡片里：不改变全局形态（可能只是还没挂到 DOM 上）。
              setGeometry(null);
              return;
            }
            if (probe.hidden === true) {
              // 这个 composer 没画出来（隐藏的侧边栏聊天）：交给别的实例判断。
              setGeometry(null);
              return;
            }
            if (probe.seat === null) {
              seatRef.current = null;
              setMode('toolbar');
              setGeometry(null);
              return;
            }
            seatRef.current = probe.seat;
            setMode('seat');
            applySkin(readSeatSkin(probe.seat));
            var next =
              probe.seat.disabled === true
                ? { left: probe.rect.left, top: probe.rect.top, width: probe.rect.width, height: probe.rect.height }
                : null;
            setGeometry(function (prev) {
              if (prev === null && next === null) return null;
              if (prev === null || next === null) return next;
              if (
                Math.abs(prev.left - next.left) < 0.5 &&
                Math.abs(prev.top - next.top) < 0.5 &&
                Math.abs(prev.width - next.width) < 0.5 &&
                Math.abs(prev.height - next.height) < 0.5
              ) {
                return prev;
              }
              return next;
            });
          }

          tickOnce();

          var first = probeSeat(anchorRef.current);
          if (first !== null && first.seat !== null && typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(tickOnce);
            observer.observe(first.card);
            if (first.seat.parentElement) observer.observe(first.seat.parentElement);
          }
          // 草稿一变，宿主会在同一颗 key 上摘掉 disabled；用 MutationObserver 抢在下一帧前收手。
          if (first !== null && first.seat !== null && typeof MutationObserver === 'function') {
            mutate = new MutationObserver(tickOnce);
            mutate.observe(first.seat, { attributes: true, attributeFilter: ['disabled', 'class', 'style'] });
          }
          var onScroll = function () {
            tickOnce();
          };
          window.addEventListener('resize', tickOnce);
          window.addEventListener('scroll', onScroll, true);
          var interval = window.setInterval(tickOnce, 700);

          return function () {
            stopped = true;
            window.clearInterval(interval);
            window.removeEventListener('resize', tickOnce);
            window.removeEventListener('scroll', onScroll, true);
            if (observer !== null) observer.disconnect();
            if (mutate !== null) mutate.disconnect();
          };
        },
        [sessionId, running, seq, placement, allowed],
      );

      function onSeatClick(event) {
        event.preventDefault();
        event.stopPropagation();
        var probe = probeSeat(anchorRef.current);
        var seat = probe !== null && probe.seat !== null ? probe.seat : null;
        if (seat === null || seat.disabled !== true) {
          // 宿主键位已经可用（用户刚打了字）：把这一下点转交给宿主，别吞掉真正的发送。
          setGeometry(null);
          try {
            if (seat !== null) seat.click();
          } catch (error) {
            /* host button refused the synthetic click; nothing else to do */
          }
          return;
        }
        action.run();
      }

      var label = t('title');
      var body = h('span', { ref: anchorRef, style: { display: 'none' } }, null);

      if (!show) return body;

      var seatStyle = {
        left: geometry.left + 'px',
        top: geometry.top + 'px',
        width: geometry.width + 'px',
        height: geometry.height + 'px',
        background: skin ? skin.background : 'var(--dsw-alias-brand-primary)',
        color: skin ? skin.color : '#ffffff',
        borderRadius: skin ? skin.radius : '999px',
      };

      var button = h(
        'button',
        {
          type: 'button',
          className: 'rs-seat',
          style: seatStyle,
          'data-phase': action.phase,
          'aria-label': label,
          onMouseDown: function (event) {
            event.preventDefault();
          },
          onMouseEnter: function () {
            setHovered(true);
          },
          onMouseLeave: function () {
            setHovered(false);
          },
          onClick: onSeatClick,
        },
        action.phase === 'sending'
          ? h(SpinnerGlyph, { size: Math.max(12, Math.round(geometry.width * 0.44)) })
          : h(PlayGlyph, { size: Math.max(12, Math.round(geometry.width * 0.47)) }),
      );

      var hasMessage = action.message !== null && action.message !== undefined;
      var tooltip = null;
      if (hovered || hasMessage) {
        var tipStyle = {
          right: Math.max(8, Math.round(window.innerWidth - (geometry.left + geometry.width))) + 'px',
          bottom: Math.max(8, Math.round(window.innerHeight - geometry.top + 8)) + 'px',
        };
        tooltip = h(
          'div',
          { className: 'rs-tip', style: tipStyle },
          hasMessage
            ? h('div', { className: 'rs-tip-error' }, action.message)
            : h(
                'div',
                null,
                h('div', { className: 'rs-tip-title' }, label),
                h('div', { className: 'rs-tip-cause' }, info.summary ? info.summary : t('cause.generic')),
                h('div', { className: 'rs-tip-hint' }, t('hint')),
              ),
        );
      }

      return h(
        React.Fragment,
        null,
        body,
        createPortal(button, document.body),
        tooltip !== null ? createPortal(tooltip, document.body) : null,
      );
    }

    // ------------------------------------------------------------------ 工具条降级控件

    function ResumeToolbar(props) {
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var t = props.t;
      var running = typeof useSession === 'function' ? useSession(function (s) { return s.running; }) : undefined;
      var statePair = useResumeState(sessionId, running, t);
      var info = statePair[0];
      var refresh = statePair[1];
      var action = useContinueAction(sessionId, info, refresh, t);
      var modeValue = useMode();

      if (modeValue !== 'toolbar') return null;
      if (!eligible(info, running)) return null;

      return h(
        'button',
        {
          type: 'button',
          className: 'rs-inline',
          'aria-label': t('title'),
          title: t('title') + (info.summary ? ' · ' + info.summary : ''),
          onMouseDown: function (event) {
            event.preventDefault();
          },
          onClick: function (event) {
            event.preventDefault();
            event.stopPropagation();
            action.run();
          },
        },
        action.phase === 'sending' ? h(SpinnerGlyph, { size: 14 }) : h(PlayGlyph, { size: 14 }),
      );
    }

    // ------------------------------------------------------------------ 转录里的「▶ 继续」行

    var ROW_KIND = 'resume-continue';

    /** 与 ui-chat 的 turn-error 同款的节点形状（chatNode 是包内私有函数，字段照抄）。 */
    function resumeRowNode(context, data) {
      var location =
        (context.start && context.start.location) ||
        (context.matches[0] && context.matches[0].location) ||
        { kind: 'unresolved' };
      return {
        key: context.key,
        kind: ROW_KIND,
        id: context.id,
        target: 'chat',
        anchorSeq: data.seq,
        location: location,
        visibility: 'visible',
        groupTree: 'turn',
        data: data,
      };
    }

    /** 只有这几种终止原因才值得给一行「继续」；blocked/completed/forked 不给。 */
    function reasonCode(reason) {
      if (reason === null || typeof reason !== 'object') return null;
      switch (reason.kind) {
        case 'error':
          return (reason.error && reason.error.code) || 'LLM_ERROR';
        case 'aborted':
          return 'ABORTED';
        case 'interrupted':
          return 'PROCESS_EXIT';
        case 'max-tokens':
          return 'MAX_TOKENS';
        default:
          return null;
      }
    }

    function ResumeRow(props) {
      var t = props.t;
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var node = props.node || {};
      var data = node.data || {};
      var running = typeof useSession === 'function' ? useSession(function (s) { return s.running; }) : undefined;

      var pair = useResumeState(sessionId, running, t);
      var info = pair[0];
      var refresh = pair[1];
      var ignoredState = React.useState(false);
      var ignored = ignoredState[0];
      var setIgnored = ignoredState[1];
      var phaseState = React.useState('idle');
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var errorState = React.useState(null);
      var error = errorState[0];
      var setError = errorState[1];

      if (ignored) return null;
      if (typeof data.seq !== 'number') return null;
      // 只给"当前这一次中断"提供入口：历史里的旧中断不重复出现。
      if (!info || !info.state || info.state.eligible !== true || info.state.seq !== data.seq) return null;

      function onContinue(event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (phase === 'sending') return;
        setPhase('sending');
        setError(null);
        postContinue(sessionId, { seq: data.seq, turn: data.turn }, t).then(function (json) {
          if (json && json.ok === true) {
            refresh();
            setPhase('idle');
            return;
          }
          setPhase('idle');
          setError(errorText(t, (json && json.code) || 'unknown'));
          window.setTimeout(function () {
            setError(null);
          }, 5000);
        });
      }

      return h(
        'div',
        { className: 'rs-row', role: 'status' },
        h('span', { className: 'rs-row-glyph' }, h(PlayGlyph, { size: 14 })),
        h(
          'span',
          { className: error === null ? 'rs-row-text' : 'rs-row-text rs-row-err' },
          error === null ? info.summary || t('row.title') : error,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rs-row-btn',
            'data-primary': 'true',
            disabled: phase === 'sending',
            onClick: onContinue,
          },
          phase === 'sending' ? t('row.sending') : t('row.continue'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rs-row-btn',
            disabled: phase === 'sending',
            onClick: function (event) {
              event.preventDefault();
              event.stopPropagation();
              setIgnored(true);
            },
          },
          t('row.ignore'),
        ),
      );
    }

    /** 发一条续跑指令（工具条按钮、覆盖层、转录行共用）。 */
    function postContinue(sessionId, seq, t) {
      var body = { sessionId: sessionId, lang: languageTag(t) };
      if (typeof seq === 'number') body.seq = seq;
      return fetch(ROUTE + '/continue', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json();
        })
        .catch(function () {
          return { ok: false, code: 'network' };
        });
    }

    // ------------------------------------------------------------------ 入口

    function apply(ctx) {
      installStyles();

      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, 'dsh-resume: dictionaries');
      var t = ctx.locale.bind(NS);

      function makeBound(Component) {
        return function Bound(props) {
          return h(Component, Object.assign({}, props, { t: t }));
        };
      }

      ctx.effect(function () {
        return ctx.slots.inject(OVERLAY_SLOT, function () {
          return ctx.slots.register(
            { name: OVERLAY_SLOT, id: 'resume-seat', order: 40, locale: NS },
            makeBound(ResumeSeat),
          );
        });
      }, 'dsh-resume: composer seat');

      ctx.effect(function () {
        return ctx.slots.inject(TOOLBAR_SLOT, function () {
          return ctx.slots.register(
            { name: TOOLBAR_SLOT, id: 'resume-toolbar', order: 40, locale: NS },
            makeBound(ResumeToolbar),
          );
        });
      }, 'dsh-resume: composer toolbar');

      // 转录里的「▶ 继续」行：Definition 造节点 + keyed slot 造渲染器。
      // 两处注册都包 try/catch：撞 kind / 撞 key 都是硬抛，不能连带把发送键搞掉。
      // uiConversation 不作为硬依赖：拿不到就静默降级（只剩输入框那颗 ▶）。
      var rowState = { definition: false, renderer: false, error: null };
      var uiConversation = null;
      try {
        uiConversation = ctx.get('uiConversation') || null;
      } catch (error) {
        uiConversation = null;
        rowState.error = String(error);
      }
      if (uiConversation !== null && uiConversation.events && typeof uiConversation.events.register === 'function') {
        try {
          uiConversation.events.register({
            kind: ROW_KIND,
            target: 'chat',
            match: function (event) {
              if (event.type !== 'turn/end') return null;
              if (reasonCode(event.data && event.data.reason) === null) return null;
              return { id: String(event.data.turn), role: 'start' };
            },
            start: function (_context, matchValue) {
              var event = matchValue.event;
              return {
                turn: event.data.turn,
                seq: event.seq,
                time: event.time,
                reasonCode: reasonCode(event.data.reason),
              };
            },
            update: function (context) {
              return context.state;
            },
            buildViewNode: function (context) {
              return context.state === undefined ? null : resumeRowNode(context, context.state);
            },
          });
          rowState.definition = true;
        } catch (error) {
          rowState.error = String(error);
          if (typeof console !== 'undefined' && console.warn) console.warn('dsh-resume: chat row definition skipped', error);
        }
      }

      if (rowState.definition) {
        ctx.effect(function () {
          return ctx.slots.inject('conversation.chat.node', function () {
            try {
              var dispose = ctx.slots.register(
                { name: 'conversation.chat.node', key: ROW_KIND, locale: NS },
                makeBound(ResumeRow),
              );
              rowState.renderer = true;
              return dispose;
            } catch (error) {
              rowState.error = String(error);
              if (typeof console !== 'undefined' && console.warn) console.warn('dsh-resume: chat row renderer skipped', error);
              return function () {};
            }
          });
        }, 'dsh-resume: chat row');
      }

      // 调试句柄：DevTools 里可以直接看状态、手动触发一次继续。
      if (typeof window !== 'undefined') {
        window.__DSH_RESUME__ = {
          version: '0.1.0',
          mode: function () {
            return mode;
          },
          state: function (sessionId) {
            return fetchState(sessionId);
          },
          continue: function (sessionId, seq) {
            return fetch(ROUTE + '/continue', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: sessionId, seq: seq }),
            }).then(function (res) {
              return res.json();
            });
          },
          caps: function () {
            return rowState;
          },
          health: function () {
            return fetch(ROUTE + '/health', { credentials: 'same-origin' }).then(function (res) {
              return res.json();
            });
          },
        };
      }
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];

    return module.exports;
  },
});
