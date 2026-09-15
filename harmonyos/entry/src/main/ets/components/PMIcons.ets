import { PMColors } from '../common/DesignTokens';

/**
 * 忆程 ProjectMemo 统一线性矢量图标库
 * 规约：
 * 1. 统一 20-22vp 外框
 * 2. 统一 stroke 宽度 (1.5-2vp)
 * 3. 严禁 Emoji
 * 4. 默认灰蓝 muted 状态，选中态使用指定色（如品牌色或 Memory 深青）
 */

@Component
export struct FolderIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    Column() {
      // 文件夹上折角与底框
      Stack() {
        Row()
          .width(this.iconSize * 0.45)
          .height(this.iconSize * 0.25)
          .backgroundColor('transparent')
          .border({
            width: { top: 1.5, left: 1.5, right: 1.5 },
            color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY
          })
          .borderRadius({ topLeft: 2, topRight: 2 })
          .position({ x: 0, y: 0 })

        Row()
          .width(this.iconSize)
          .height(this.iconSize * 0.7)
          .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
          .border({
            width: 1.5,
            color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY
          })
          .borderRadius(3)
          .position({ x: 0, y: this.iconSize * 0.25 })
      }
      .width(this.iconSize)
      .height(this.iconSize)
    }
  }
}

@Component
export struct DashboardIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 工作台使用四格概览图形，与项目文件夹和成果文档区分开。
    Stack() {
      Row()
        .width(this.iconSize * 0.38)
        .height(this.iconSize * 0.38)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(2)
        .position({ x: 0, y: 0 })

      Row()
        .width(this.iconSize * 0.38)
        .height(this.iconSize * 0.38)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(2)
        .position({ x: this.iconSize * 0.52, y: 0 })

      Row()
        .width(this.iconSize * 0.38)
        .height(this.iconSize * 0.38)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(2)
        .position({ x: 0, y: this.iconSize * 0.52 })

      Row()
        .width(this.iconSize * 0.38)
        .height(this.iconSize * 0.38)
        .backgroundColor(this.isSelected ? PMColors.BRAND : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(2)
        .position({ x: this.iconSize * 0.52, y: this.iconSize * 0.52 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
  }
}

@Component
export struct MemoryIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 记忆双图层/多维网络
    Stack() {
      // 后层
      Row()
        .width(this.iconSize * 0.75)
        .height(this.iconSize * 0.75)
        .backgroundColor('transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(3)
        .position({ x: this.iconSize * 0.2, y: 0 })

      // 前层
      Row()
        .width(this.iconSize * 0.75)
        .height(this.iconSize * 0.75)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(3)
        .position({ x: 0, y: this.iconSize * 0.2 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
  }
}

@Component
export struct TaskIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 待办清单板
    Stack() {
      Row()
        .width(this.iconSize * 0.85)
        .height(this.iconSize)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(3)

      Column({ space: 3 }) {
        Row()
          .width(this.iconSize * 0.45)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        Row()
          .width(this.iconSize * 0.45)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        Row()
          .width(this.iconSize * 0.3)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
      }
      .alignItems(HorizontalAlign.Start)
      .margin({ top: 3 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
  }
}

@Component
export struct CopilotIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 智能体对话气泡与核心证据星标
    Stack() {
      Row()
        .width(this.iconSize)
        .height(this.iconSize * 0.8)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(4)
        .position({ x: 0, y: 0 })

      Row()
        .width(4)
        .height(4)
        .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        .borderRadius(2)
        .position({ x: this.iconSize * 0.35, y: this.iconSize * 0.3 })

      Row()
        .width(4)
        .height(4)
        .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        .borderRadius(2)
        .position({ x: this.iconSize * 0.65, y: this.iconSize * 0.3 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
  }
}

@Component
export struct ArtifactIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 成果交付物文档
    Stack() {
      Row()
        .width(this.iconSize * 0.8)
        .height(this.iconSize)
        .backgroundColor(this.isSelected ? PMColors.BRAND_LIGHT : 'transparent')
        .border({ width: 1.5, color: this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY })
        .borderRadius(2)

      Column({ space: 2.5 }) {
        Row()
          .width(this.iconSize * 0.45)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        Row()
          .width(this.iconSize * 0.45)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        Row()
          .width(this.iconSize * 0.45)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
      }
      .margin({ top: 4 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
  }
}

@Component
export struct SettingsIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    // 极简设置调节滑块
    Column({ space: 4 }) {
      Row() {
        Row()
          .width(5)
          .height(5)
          .borderRadius(2.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        Row()
          .layoutWeight(1)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ left: 2 })
      }
      .width(this.iconSize)
      .alignItems(VerticalAlign.Center)

      Row() {
        Row()
          .layoutWeight(1)
          .height(1.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
          .margin({ right: 2 })
        Row()
          .width(5)
          .height(5)
          .borderRadius(2.5)
          .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
      }
      .width(this.iconSize)
      .alignItems(VerticalAlign.Center)
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .justifyContent(FlexAlign.Center)
  }
}

@Component
export struct MoreIcon {
  @Prop isSelected: boolean = false;
  @Prop iconSize: number = 20;

  build() {
    Row() {
      Row()
        .width(4)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
      Row()
        .width(4)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
        .margin({ left: this.iconSize * 0.18, right: this.iconSize * 0.18 })
      Row()
        .width(4)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isSelected ? PMColors.BRAND : PMColors.INK_TERTIARY)
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
  }
}

@Component
export struct AlertIcon {
  @Prop iconSize: number = 16;
  @Prop color: ResourceColor = PMColors.RISK;
  @Prop isHigh: boolean = false;

  build() {
    // 警示三角 / 提醒
    Stack() {
      Text('!')
        .fontSize(10)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.color)
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .border({ width: 1.5, color: this.color })
    .borderRadius(this.iconSize / 2)
    .alignContent(Alignment.Center)
  }
}

@Component
export struct ClockIcon {
  @Prop iconSize: number = 14;
  @Prop color: ResourceColor = PMColors.RISK;

  build() {
    Stack() {
      Row()
        .width(1.2)
        .height(this.iconSize * 0.35)
        .backgroundColor(this.color)
        .position({ x: (this.iconSize / 2) - 0.6, y: this.iconSize * 0.15 })

      Row()
        .width(this.iconSize * 0.3)
        .height(1.2)
        .backgroundColor(this.color)
        .position({ x: (this.iconSize / 2) - 0.6, y: (this.iconSize / 2) - 0.6 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .border({ width: 1.2, color: this.color })
    .borderRadius(this.iconSize / 2)
  }
}

@Component
export struct CheckIcon {
  @Prop iconSize: number = 14;
  @Prop color: ResourceColor = PMColors.SUCCESS;

  build() {
    Stack() {
      Text('✓')
        .fontSize(11)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.color)
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .border({ width: 1.2, color: this.color })
    .borderRadius(this.iconSize / 2)
    .alignContent(Alignment.Center)
  }
}

@Component
export struct SpineNodeIcon {
  @Prop isJudgement: boolean = false;
  @Prop color: ResourceColor = PMColors.EVIDENCE;
  @Prop iconSize: number = 10;

  build() {
    if (this.isJudgement) {
      Row()
        .width(this.iconSize)
        .height(this.iconSize)
        .backgroundColor(PMColors.RISK)
        .borderRadius(2)
        .rotate({ angle: 45 })
    } else {
      Row()
        .width(this.iconSize)
        .height(this.iconSize)
        .backgroundColor(PMColors.SURFACE)
        .border({ width: 2, color: this.color })
        .borderRadius(this.iconSize / 2)
    }
  }
}

@Component
export struct PaperclipIcon {
  @Prop iconSize: number = 16;
  @Prop color: ResourceColor = PMColors.BRAND;

  build() {
    Stack() {
      Row()
        .width(this.iconSize * 0.45)
        .height(this.iconSize * 0.75)
        .border({ width: 1.5, color: this.color })
        .borderRadius({ topLeft: 4, topRight: 4, bottomLeft: 4, bottomRight: 4 })
        .rotate({ angle: -30 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .alignContent(Alignment.Center)
  }
}

@Component
export struct BookOpenIcon {
  @Prop iconSize: number = 20;
  @Prop color: ResourceColor = PMColors.BRAND;

  build() {
    Row({ space: 2 }) {
      Row()
        .width(this.iconSize * 0.45)
        .height(this.iconSize * 0.65)
        .border({ width: 1.5, color: this.color })
        .borderRadius({ topLeft: 2, bottomLeft: 2 })
      Row()
        .width(this.iconSize * 0.45)
        .height(this.iconSize * 0.65)
        .border({ width: 1.5, color: this.color })
        .borderRadius({ topRight: 2, bottomRight: 2 })
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
  }
}

@Component
export struct CheckboxIcon {
  @Prop isChecked: boolean = false;
  @Prop isDisabled: boolean = false;
  @Prop iconSize: number = 18;

  build() {
    Stack() {
      if (this.isChecked) {
        Row()
          .width(this.iconSize)
          .height(this.iconSize)
          .backgroundColor(this.isDisabled ? PMColors.INK_MUTED : PMColors.BRAND)
          .borderRadius(3)
        Text('✓')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.SURFACE)
      } else {
        Row()
          .width(this.iconSize)
          .height(this.iconSize)
          .backgroundColor(PMColors.SURFACE)
          .border({ width: 1.5, color: this.isDisabled ? PMColors.BORDER_STRONG : PMColors.INK_TERTIARY })
          .borderRadius(3)
      }
    }
    .width(this.iconSize)
    .height(this.iconSize)
    .alignContent(Alignment.Center)
  }
}

