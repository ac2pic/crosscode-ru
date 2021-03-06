ig.module('crosscode-ru.fixes.help.level-entry')
  .requires(
    'game.feature.menu.gui.help.help-misc',
    'localize-me.final-locale.ready',
  )
  .defines(() => {
    if (ig.currentLang !== 'ru_RU') return;

    // TODO: find a more dynamic approach
    const LEVEL_COLOR_ADDITIONAL_WIDTH = 10;
    sc.HelpLevelEntry.inject({
      init(colorId, fontColor) {
        this.parent(colorId, fontColor);
        this.desc.hook.pos.x += LEVEL_COLOR_ADDITIONAL_WIDTH;
        this.desc.textBlock.maxWidth! -= LEVEL_COLOR_ADDITIONAL_WIDTH;
        this.desc.setText(this.desc.text);
        this.setSize(
          Math.max(
            this.color.hook.pos.x + this.color.hook.size.x,
            this.desc.hook.pos.x + this.desc.hook.size.x,
          ),
          Math.max(this.desc.hook.size.y, this.color.hook.size.y),
        );
      },
    });
  });
