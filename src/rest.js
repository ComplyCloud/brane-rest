import { Module } from '@complycloud/brane';

export default class RESTInterface extends Module {
  get id() { return 'rest'; }
  get dependencies() { return ['log']; }

  async start({ log }) {
    log.info('rest started');
  }
}
