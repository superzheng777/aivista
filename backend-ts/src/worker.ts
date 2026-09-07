import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { GenerationWorkerModule } from "./generation-worker.module.js";

const app = await NestFactory.createApplicationContext(GenerationWorkerModule);
app.enableShutdownHooks();
