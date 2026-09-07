// Idempotent initialization: no demonstration people, rates, work or money.
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()
async function main() {
  await db.ruleVersion.upsert({ where: { version: 1 }, update: {}, create: {
    version: 1,
    contentJson: JSON.stringify({summary:"Деньги и подтверждённый труд учитываются отдельно. Старания включены по умолчанию.", formulaText:"Неоплаченные часы × согласованная ставка + денежные вложения − выплаты", rounding:"Деньги хранятся в копейках", effortCredit:true}),
  } })
  await db.modelProfile.upsert({where:{profileId:"omniroute-v1"}, update:{}, create:{
    profileId:"omniroute-v1", simulationMode:false,
    modelsJson:JSON.stringify([{key:"glm-5.3",family:"GLM",tag:"glm-5.3"},{key:"gpt-6",family:"GPT",tag:"gpt-6"}]),
    seedsJson:"[1,2,3]", samplesPerModel:3,
  }})
  console.log("Initialized policy and model profile; no ledger records or participants created")
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>db.$disconnect())
