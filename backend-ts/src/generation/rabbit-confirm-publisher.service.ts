import { Injectable,OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect,type ChannelModel,type ConfirmChannel,type ConsumeMessage } from "amqplib";
import type { Environment } from "../config/environment.js";

@Injectable()
export class RabbitConfirmPublisherService implements OnModuleDestroy {
  private connection:ChannelModel|undefined;
  private channelPromise:Promise<ConfirmChannel>|undefined;
  private readonly options:RabbitOptions;

  constructor(config:ConfigService<Environment,true>){
    this.options={
      host:config.get("AIVISTA_RABBITMQ_HOST",{infer:true}),port:config.get("AIVISTA_RABBITMQ_PORT",{infer:true}),
      username:config.get("AIVISTA_RABBITMQ_USERNAME",{infer:true}),password:config.get("AIVISTA_RABBITMQ_PASSWORD",{infer:true}),
      vhost:config.get("AIVISTA_RABBITMQ_VHOST",{infer:true}),exchange:config.get("AIVISTA_GENERATION_EXCHANGE",{infer:true}),
      deadLetterExchange:config.get("AIVISTA_GENERATION_DEAD_LETTER_EXCHANGE",{infer:true}),
      generationQueue:config.get("AIVISTA_GENERATION_QUEUE_NAME",{infer:true}),generationKey:config.get("AIVISTA_GENERATION_ROUTING_KEY",{infer:true}),
      transferQueue:config.get("AIVISTA_TRANSFER_QUEUE_NAME",{infer:true}),transferKey:config.get("AIVISTA_TRANSFER_ROUTING_KEY",{infer:true}),
      workerResultQueue:config.get("AIVISTA_GENERATION_WORKER_RESULT_QUEUE_NAME",{infer:true}),
      workerResultKey:config.get("AIVISTA_GENERATION_WORKER_RESULT_ROUTING_KEY",{infer:true}),
      workerResultDeadLetterQueue:config.get("AIVISTA_GENERATION_WORKER_RESULT_DEAD_LETTER_QUEUE_NAME",{infer:true}),
      workerResultDeadLetterKey:config.get("AIVISTA_GENERATION_WORKER_RESULT_DEAD_LETTER_ROUTING_KEY",{infer:true}),
      timeoutMs:config.get("AIVISTA_RABBITMQ_CONFIRM_TIMEOUT_MS",{infer:true}),
    };
  }

  async publish(routingKey:string,messageId:string,body:Buffer):Promise<void>{
    const channel=await this.channel();
    await new Promise<void>((resolve,reject)=>{
      let returned=false;let settled=false;
      const onReturn=(message:ConsumeMessage)=>{if(message.properties.messageId===messageId)returned=true;};
      const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);channel.off("return",onReturn);error?reject(error):resolve();};
      const timer=setTimeout(()=>finish(new Error("RabbitMQ publisher confirm timed out")),this.options.timeoutMs);
      channel.on("return",onReturn);
      channel.publish(this.options.exchange,routingKey,body,{contentType:"application/json",contentEncoding:"UTF-8",persistent:true,mandatory:true,messageId},error=>{
        setImmediate(()=>finish(error??(returned?new Error("RabbitMQ message was not routed to a queue"):undefined)));
      });
    });
  }

  async ensureTopology():Promise<void>{await this.channel();}

  async onModuleDestroy(){const channel=await this.channelPromise?.catch(()=>undefined);if(channel)await channel.close();if(this.connection)await this.connection.close();}

  private channel(){
    if(this.channelPromise)return this.channelPromise;
    const pending=this.createChannel().catch(error=>{if(this.channelPromise===pending)this.channelPromise=undefined;throw error;});
    this.channelPromise=pending;
    return pending;
  }
  private async createChannel(){
    if(!this.options.host||!this.options.username||!this.options.password)throw new Error("RabbitMQ configuration is missing");
    const connection=await connect({protocol:"amqp",hostname:this.options.host,port:this.options.port,username:this.options.username,password:this.options.password,vhost:this.options.vhost});
    this.connection=connection;
    connection.on("close",()=>{this.connection=undefined;this.channelPromise=undefined;});
    const channel=await connection.createConfirmChannel();
    await channel.assertExchange(this.options.exchange,"direct",{durable:true});
    await channel.assertExchange(this.options.deadLetterExchange,"direct",{durable:true});
    await channel.assertQueue(this.options.generationQueue,{durable:true,arguments:{"x-queue-type":"quorum"}});
    await channel.assertQueue(this.options.transferQueue,{durable:true,arguments:{"x-queue-type":"quorum"}});
    await channel.assertQueue(this.options.workerResultQueue,{durable:true,arguments:{"x-queue-type":"quorum","x-dead-letter-exchange":this.options.deadLetterExchange,"x-dead-letter-routing-key":this.options.workerResultDeadLetterKey}});
    await channel.assertQueue(this.options.workerResultDeadLetterQueue,{durable:true,arguments:{"x-queue-type":"quorum"}});
    await channel.bindQueue(this.options.generationQueue,this.options.exchange,this.options.generationKey);
    await channel.bindQueue(this.options.transferQueue,this.options.exchange,this.options.transferKey);
    await channel.bindQueue(this.options.workerResultQueue,this.options.exchange,this.options.workerResultKey);
    await channel.bindQueue(this.options.workerResultDeadLetterQueue,this.options.deadLetterExchange,this.options.workerResultDeadLetterKey);
    return channel;
  }
}

interface RabbitOptions {host:string|undefined;port:number;username:string|undefined;password:string|undefined;vhost:string;exchange:string;deadLetterExchange:string;generationQueue:string;generationKey:string;transferQueue:string;transferKey:string;workerResultQueue:string;workerResultKey:string;workerResultDeadLetterQueue:string;workerResultDeadLetterKey:string;timeoutMs:number}
