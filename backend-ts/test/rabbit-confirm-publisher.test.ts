import {EventEmitter} from "node:events";
import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({connect:vi.fn()}));
vi.mock("amqplib",()=>({connect:mocks.connect}));
import {RabbitConfirmPublisherService} from "../src/generation/rabbit-confirm-publisher.service.js";

describe("Rabbit confirm publisher",()=>{
  beforeEach(()=>mocks.connect.mockReset());
  it("declares the Java topology and confirms a persistent mandatory message",async()=>{
    const channel=Object.assign(new EventEmitter(),{
      assertExchange:vi.fn(async()=>undefined),assertQueue:vi.fn(async()=>undefined),bindQueue:vi.fn(async()=>undefined),
      publish:vi.fn((_exchange:string,_key:string,_body:Buffer,_options:unknown,callback:(error:null)=>void)=>callback(null)),close:vi.fn(async()=>undefined),
    });
    const connection=Object.assign(new EventEmitter(),{createConfirmChannel:vi.fn(async()=>channel),close:vi.fn(async()=>undefined)});
    mocks.connect.mockResolvedValue(connection);
    const publisher=new RabbitConfirmPublisherService({get:(key:string)=>config[key]} as never);
    await publisher.publish("generation.task.execute","outbox-11",Buffer.from("{}"));
    expect(channel.assertExchange).toHaveBeenCalledWith("aivista.generation.commands","direct",{durable:true});
    expect(channel.assertExchange).toHaveBeenCalledWith("aivista.generation.dead-letter","direct",{durable:true});
    expect(channel.assertQueue).toHaveBeenCalledWith("generation.task.execute",{durable:true,arguments:{"x-queue-type":"quorum"}});
    expect(channel.assertQueue).toHaveBeenCalledWith("generation.image.transfer",{durable:true,arguments:{"x-queue-type":"quorum"}});
    expect(channel.publish).toHaveBeenCalledWith("aivista.generation.commands","generation.task.execute",Buffer.from("{}"),{contentType:"application/json",contentEncoding:"UTF-8",persistent:true,mandatory:true,messageId:"outbox-11"},expect.any(Function));
    await publisher.onModuleDestroy();
  });
});

const config:Record<string,unknown>={AIVISTA_RABBITMQ_HOST:"localhost",AIVISTA_RABBITMQ_PORT:5672,AIVISTA_RABBITMQ_USERNAME:"guest",AIVISTA_RABBITMQ_PASSWORD:"guest",AIVISTA_RABBITMQ_VHOST:"/aivista",AIVISTA_GENERATION_EXCHANGE:"aivista.generation.commands",AIVISTA_GENERATION_DEAD_LETTER_EXCHANGE:"aivista.generation.dead-letter",AIVISTA_GENERATION_QUEUE_NAME:"generation.task.execute",AIVISTA_GENERATION_ROUTING_KEY:"generation.task.execute",AIVISTA_TRANSFER_QUEUE_NAME:"generation.image.transfer",AIVISTA_TRANSFER_ROUTING_KEY:"generation.image.transfer",AIVISTA_GENERATION_WORKER_RESULT_QUEUE_NAME:"generation.worker.result",AIVISTA_GENERATION_WORKER_RESULT_ROUTING_KEY:"generation.worker.result",AIVISTA_GENERATION_WORKER_RESULT_DEAD_LETTER_QUEUE_NAME:"generation.worker.result.dead-letter",AIVISTA_GENERATION_WORKER_RESULT_DEAD_LETTER_ROUTING_KEY:"generation.worker.result.dead-letter",AIVISTA_RABBITMQ_CONFIRM_TIMEOUT_MS:10000};
