import { FitPremise, FitCheck } from '../models/EvidenceFit';
import { PMColors, PMFontSize, PMSpacing, PMRadius } from '../common/DesignTokens';
@Component
export struct MissionEvidenceReview {
 @State private expanded: boolean = false;
 @Prop premise: FitPremise = new FitPremise();
 @Prop mode: string = 'CONDITIONAL_ANALYSIS';
 @Prop confirmed: boolean = false;
 @Prop disabled: boolean = false;
 onMode: (mode: string) => void = (): void => {};
 onConfirm: (value: boolean) => void = (): void => {};
 build() {
  Column({ space: PMSpacing.SM }) {
   Row({ space: 8 }) {
    Text('测量条件与用途').fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
    Button(this.expanded ? '收起 ⌃' : this.confirmed ? '已核对 ⌄' : '待核对 ⌄', { type: ButtonType.Normal })
     .height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 8, right: 0 })
     .onClick(() => { this.expanded = !this.expanded; })
   }.width('100%')
   Text(`GPU 内存 · ${this.premise.measurement.period ?? '期间待核对'} · ${this.premise.measurement.upperLimit === undefined ? this.premise.measurement.unit : '预算上限 ' + this.premise.measurement.upperLimit + ' ' + this.premise.measurement.unit}`)
    .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
   if (this.expanded) {
   ForEach(this.premise.checks, (check: FitCheck) => {
    Text(`${check.id === 'SUBJECT' ? '主体' : check.id === 'STAGE' ? '阶段' : '条件'} · ${check.expected}`)
     .fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
   }, (check: FitCheck) => check.id)
   if (this.premise.basisStatus !== 'GROUNDED') { Text('部分条件尚不能对应原问题，请保留未知分析。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.WARNING) }
   Select([{ value: '回答这次测量问题' }, { value: '保留未知，继续条件分析' }, { value: '仅作背景，继续等待' }])
    .selected(this.mode === 'ANSWERING_EVIDENCE' ? 0 : this.mode === 'BACKGROUND_ONLY' ? 2 : 1)
    .value(this.mode === 'ANSWERING_EVIDENCE' ? '回答这次测量问题' : this.mode === 'BACKGROUND_ONLY' ? '仅作背景，继续等待' : '保留未知，继续条件分析')
    .selectedOptionFontColor(PMColors.BRAND).selectedOptionBgColor(PMColors.BRAND_LIGHT).optionFontColor(PMColors.INK_PRIMARY)
    .width('100%').height(44).font({ size: PMFontSize.SECONDARY }).fontColor(PMColors.INK_PRIMARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.SM)
    .enabled(!this.disabled).onSelect((index: number) => { this.onMode(index === 0 ? 'ANSWERING_EVIDENCE' : index === 2 ? 'BACKGROUND_ONLY' : 'CONDITIONAL_ANALYSIS'); })
   Row({ space: PMSpacing.SM }) {
    Checkbox({ name: 'evidence-premise-reviewed' }).select(this.confirmed).selectedColor(PMColors.BRAND).enabled(!this.disabled).onChange((value: boolean) => { this.onConfirm(value); })
    Text('我已核对以上条件与原问题的关系').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
   }.width('100%')
   }
  }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 8 })
    .border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
 }
}
