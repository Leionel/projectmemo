import { FitPremise, FitCheck } from '../models/EvidenceFit';
import { PMColors, PMFontSize, PMSpacing, PMRadius } from '../common/DesignTokens';
@Component
export struct MissionEvidenceReview {
 @Prop premise: FitPremise = new FitPremise();
 @Prop mode: string = 'CONDITIONAL_ANALYSIS';
 @Prop confirmed: boolean = false;
 @Prop disabled: boolean = false;
 onMode: (mode: string) => void = (): void => {};
 onConfirm: (value: boolean) => void = (): void => {};
 build() {
  Column({ space: PMSpacing.SM }) {
   Text('核对这次测量的条件').fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
   Text(`GPU 内存 · ${this.premise.measurement.period ?? '期间待核对'} · ${this.premise.measurement.upperLimit === undefined ? this.premise.measurement.unit : '预算上限 ' + this.premise.measurement.upperLimit + ' ' + this.premise.measurement.unit}`)
    .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
   ForEach(this.premise.checks, (check: FitCheck) => {
    Text(`${check.id === 'SUBJECT' ? '主体' : check.id === 'STAGE' ? '阶段' : '条件'} · ${check.expected}`)
     .fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
   }, (check: FitCheck) => check.id)
   if (this.premise.basisStatus !== 'GROUNDED') { Text('部分条件尚不能对应原问题，请保留未知分析。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.WARNING) }
   Select([{ value: '回答这次测量问题' }, { value: '保留未知，继续条件分析' }, { value: '仅作背景，继续等待' }])
    .selected(this.mode === 'ANSWERING_EVIDENCE' ? 0 : this.mode === 'BACKGROUND_ONLY' ? 2 : 1)
    .selectedOptionFontColor(PMColors.BRAND).selectedOptionBgColor(PMColors.BRAND_LIGHT).optionFontColor(PMColors.INK_PRIMARY)
    .font({ size: PMFontSize.SECONDARY }).fontColor(PMColors.INK_PRIMARY).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.SM)
    .enabled(!this.disabled).onSelect((index: number) => { this.onMode(index === 0 ? 'ANSWERING_EVIDENCE' : index === 2 ? 'BACKGROUND_ONLY' : 'CONDITIONAL_ANALYSIS'); })
   Row({ space: PMSpacing.SM }) {
    Checkbox({ name: 'evidence-premise-reviewed' }).select(this.confirmed).selectedColor(PMColors.BRAND).enabled(!this.disabled).onChange((value: boolean) => { this.onConfirm(value); })
    Text('我已核对以上条件与原问题的关系').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
   }.width('100%')
  }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
 }
}
