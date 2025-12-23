import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as zmq from 'zeromq';

@Injectable()
export class ZmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZmqService.name);
  private socket: zmq.Subscriber;

  async onModuleInit() {
    const useZmq = process.env.USE_ZMQ === 'true';
    if (!useZmq) {
      this.logger.log('ZMQ listener is disabled.');
      return;
    }

    const zmqUrl = process.env.ZMQ_URL;
    if (!zmqUrl) {
      this.logger.error('ZMQ_URL is not defined in .env');
      return;
    }

    this.logger.log(`Initializing ZMQ listener on ${zmqUrl}...`);
    this.socket = new zmq.Subscriber();

    try {
      this.socket.connect(zmqUrl);
      this.logger.log('ZMQ socket connected.');

      // Subscribe to topics
      // 'hashtx' - new transaction hash
      // 'rawtx' - new raw transaction
      // 'hashblock' - new block hash
      // 'rawblock' - new raw block
      this.socket.subscribe('hashtx');
      this.socket.subscribe('hashblock');
      
      this.logger.log('Subscribed to "hashtx" and "hashblock" topics.');

      // Start listening loop
      this.runLoop();
    } catch (error) {
      this.logger.error(`Failed to connect to ZMQ: ${error.message}`);
    }
  }

  async runLoop() {
    for await (const [topic, message] of this.socket) {
      const topicName = topic.toString();
      const hexData = message.toString('hex');

      if (topicName === 'hashtx') {
        this.logger.log(`[Mempool] New Transaction: ${hexData}`);
        // Here you can process the new transaction hash
      } else if (topicName === 'hashblock') {
        this.logger.log(`[Block] New Block: ${hexData}`);
        // Here you can process the new block hash
      }
    }
  }

  onModuleDestroy() {
    if (this.socket) {
      this.socket.close();
      this.logger.log('ZMQ socket closed.');
    }
  }
}
