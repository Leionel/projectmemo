import {AppError} from "@/lib/api";
/** Generic SourceConnection rows cannot enter a GitHub transport. */
export function githubConnection<T extends {provider?:string;repo:string|null;ref:string|null}>(row:T):T&{repo:string;ref:string}{
  if(row.provider&&row.provider!=="GITHUB"||!row.repo||!row.ref)throw new AppError("CONNECTION_NOT_FOUND","仓库连接不可访问",404);
  return {...row,repo:row.repo,ref:row.ref};
}
