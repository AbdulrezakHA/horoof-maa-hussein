ملفات الأصوات الحقيقية (اختياري)
================================

الأصوات تُولَّد تلقائياً بالكود ولا تحتاج أي ملف.
لاستبدال صوت معيّن بملف حقيقي (ogg / mp3 / wav):

1) ضع الملف في هذا المجلد (public/sounds/).
2) أضف اسمه في manifest.json، مثلاً:
   { "buzz": "bell.ogg", "point": "coin.ogg", "gameWin": "fanfare.ogg" }

أسماء الأصوات المتاحة:
  click, toggleOn, toggleOff, reveal, arm, open, tick, tickUrgent,
  buzz, win, correct, wrong, point, timeout, turnSwitch, celebrate, gameWin

أي صوت غير مذكور في manifest.json يبقى على الصوت المولَّد.
