export function fitReasonLabel(code:string):string {
 const labels:Record<string,string>={SUBJECT:"观察主体尚未对应",STAGE:"训练或推理阶段尚未对应",CONDITION_1:"第一项必要条件尚未对应",CONDITION_2:"第二项必要条件尚未对应",NO_MATERIAL:"尚未选入可回答问题的原资料",UNPERFORMED_OR_NEGATED:"原文描述的是未执行、计划或否定情况",NO_UNAMBIGUOUS_MEASUREMENT:"尚无一项明确的实际测量值",PREMISE_NOT_GROUNDED:"核对条件尚不能对应原问题或约束",MISSING_PERIOD:"测量期间尚未对应",MULTIPLE_SUBJECTS:"同段出现多个主体，观察归属不明确",SOURCE_UNKNOWN:"资料当前有效性未知",SOURCE_UNREADABLE:"资料正文不可读",SOURCE_SUPERSEDED:"资料已被新版本取代",SOURCE_CONTESTED:"资料仍有争议"};
 if(code.startsWith("COVERAGE_INCOMPLETE:"))return "原文尚未完整读取";
 if(code.startsWith("GROUP_LIMIT:"))return "观察数量超出本次读取范围";
 if(code.startsWith("RUN_CONFLICT:"))return "同次运行出现不同数值，请核对原记录";
 if(code==="MULTIPLE_ENVIRONMENTS")return "同段出现多个环境，观察条件不明确";
 if(code==="OBSERVATION_TOO_LONG")return "这段观察较长，尚不能明确划分条件与测量";
 if(code==="QUESTION_CONFLICT")return "原问题仍涉及冲突，本次只保留条件分析";
 return labels[code]??"仍有未核对信息";
}
