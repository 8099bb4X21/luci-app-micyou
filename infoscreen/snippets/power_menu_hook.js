        // 电源菜单快捷键：黑屏时新版 app.js 会吞掉除电源键外的所有键，这里直接开菜单；
        // 其余状态交给 app.js 的 micyou 动作处理（保留“单击/长按”配置）
        if (window.micyouPowerKey?.(event)) {
            if (!blank) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.type === 'keydown' && !event.repeat) open();
            return;
        }
