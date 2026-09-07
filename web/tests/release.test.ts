import { test, expect } from "bun:test"
import { aggregateConsortium, type JudgeResponse } from "../src/lib/aggregate"
import { postEntry, outstandingFor } from "../src/lib/ledger"
import { db } from "../src/lib/db"
import { grossMinor } from "../src/lib/money"
import { complete, JUDGE_MODELS } from "../src/lib/omniroute"

const responses: JudgeResponse[] = JUDGE_MODELS.flatMap(modelKey => [1,2,3].map(sampleIndex => ({modelKey,sampleIndex,assessable:true,workType:"dev",hoursLow:0.25,hoursHigh:0.5,priceLow:2500,priceHigh:5000,priceStatus:"rate_available",rateId:"rate-1"})))
test("six separate slots preserve short tasks", () => {
  const result=aggregateConsortium(responses)
  expect(result.collectionStatus).toBe("complete")
  expect(result.hoursLow).toBe(0.25)
  expect(result.costLow).toBe(2500)
  expect(result.financialEffectMinor).toBe(0)
})
test("missing and duplicate slots cannot establish a price", () => {
  for(const samples of [[],responses.slice(1),[...responses.slice(1),responses[1]]]) {
    expect(aggregateConsortium(samples).priceStatus).toBe("unknown")
    expect(aggregateConsortium(samples).costLow).toBeNull()
  }
})
test("integer minor-unit rounding",()=>{
  expect(grossMinor(900,10000)).toBe(2500)
  expect(grossMinor(3600,10000)).toBe(10000)
})
test("ledger retries, payouts, cancelled payouts and full reversal",async()=>{
  if(!process.env.DATABASE_URL?.includes("test")) throw new Error("Isolated test DB required")
  const id=crypto.randomUUID()
  const user=await db.user.create({data:{displayName:"Synthetic test",email:`${id}@test.invalid`}})
  const command={userId:user.id,kind:"cash_contribution" as const,amountMinor:10000,currency:"RUB",businessKey:id,sourceId:id,policyId:"honest-v1",targetEntryId:null,reason:"Test"}
  const entry=await postEntry(command)
  expect((await postEntry(command)).id).toBe(entry.id)
  await expect(postEntry({...command,amountMinor:20000})).rejects.toThrow()
  const pay=await postEntry({...command,kind:"settlement",amountMinor:3000,businessKey:id+"pay",sourceId:id+"pay",targetEntryId:entry.id})
  expect(await outstandingFor(entry.id)).toBe(7000)
  await postEntry({...command,kind:"reversal",amountMinor:3000,businessKey:id+"unpay",sourceId:id+"unpay",targetEntryId:pay.id})
  expect(await outstandingFor(entry.id)).toBe(10000)
  await postEntry({...command,kind:"reversal",businessKey:id+"undo",sourceId:id+"undo",targetEntryId:entry.id})
  const records=await db.ledgerEntry.findMany({where:{userId:user.id}})
  expect(records.reduce((sum,e)=>sum+e.amountMinor,0)).toBe(0)
  await expect(postEntry({...command,businessKey:id+"fraction",amountMinor:1.5})).rejects.toThrow()
})
test("router rejects unannounced model substitution",async()=>{
  const previous=globalThis.fetch
  const oldKey=process.env.OMNIROUTE_API_KEY
  process.env.OMNIROUTE_API_KEY="synthetic-test"
  globalThis.fetch=(async()=>Response.json({model:"other",choices:[{message:{content:"{}"}}]})) as typeof fetch
  try { await expect(complete("glm-5.3",[{role:"user",content:"test"}])).rejects.toThrow("Оценка не засчитана") }
  finally {globalThis.fetch=previous; if(oldKey===undefined) delete process.env.OMNIROUTE_API_KEY; else process.env.OMNIROUTE_API_KEY=oldKey}
})
