import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth"
import { CaptureInput, summarizeCapture } from "@/lib/capture-report"
import { digest } from "@/lib/canonical"
import { SUMMARY_MODEL } from "@/lib/omniroute"

export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}) {
  const user=await getCurrentUser()
  if (!user) return NextResponse.json({error:"Войдите в свой аккаунт"},{status:401})
  const {id}=await ctx.params
  const task=await db.task.findUnique({where:{id}})
  if (!task || task.ownerId!==user.id || task.workspaceId!==user.workspaceId) return NextResponse.json({error:"Задача недоступна"},{status:404})
  const raw=await req.text()
  if (raw.length>60000) return NextResponse.json({error:"Слишком много текста"},{status:413})
  let input
  try {input=CaptureInput.parse(JSON.parse(raw))} catch {return NextResponse.json({error:"Проверьте выдержки записи: максимум24, общий текст до18000 символов"},{status:422})}
  const businessKey=`capture:${user.workspaceId}:${task.id}:${digest({input,model:SUMMARY_MODEL,version:1})}`
  let job
  try {job=await db.job.create({data:{workspaceId:user.workspaceId,actorId:user.id,kind:"summarize",businessKey,state:"running",attempts:1,payloadJson:JSON.stringify({taskId:id,sessionId:input.sessionId})}})}
  catch (error:any) {
    if (error?.code!=="P2002") throw error
    const existing=await db.job.findUnique({where:{businessKey}})
    return NextResponse.json({...JSON.parse(existing?.checkpointJson||"{}"),state:existing?.state,error:existing?.state!=="done"?"Запрос уже принят. Проверьте состояние; автоматического повторения нет.":undefined},{status:existing?.state==="done"?200:409})
  }
  let receipt:any
  try {
    const result=await summarizeCapture(task.title,input);receipt=result.receipt
    const saved=await db.$transaction(async tx=>{
      const version=await tx.reportVersion.count({where:{taskId:id}})+1
      const report=await tx.reportVersion.create({data:{taskId:id,version,status:"draft",contentJson:JSON.stringify(result.report),sourcesManifest:JSON.stringify(input.excerpts)}})
      const response={report,content:result.report,metadata:receipt,billing:{mode:process.env.VKLAD_LLM_MODE==="subscription"?"subscription":"api",chargedAmount:null,note:"Цена этого запроса не сообщается провайдером; расход токенов в usage. Подписка оплачивается отдельно."}}
      await tx.job.update({where:{id:job.id},data:{state:"done",checkpointJson:JSON.stringify(response)}})
      return response
    })
    return NextResponse.json(saved,{status:201})
  } catch(error:any) {
    await db.job.update({where:{id:job.id},data:{state:"failed",lastError:String(error?.message??error).slice(0,400),checkpointJson:JSON.stringify({metadata:receipt??error?.completionReceipt??null})}})
    return NextResponse.json({error:"Сводка не получена или не прошла проверку. Запрос не будет повторён автоматически.",jobId:job.id},{status:502})
  }
}
