

// 长按判定需要“抬起”：与 keydown 同一套消费规则（黑屏下也一样）
document.addEventListener('keyup', (e) => {
	if (micyouKeyUp(e)) e.preventDefault();
}, true);
