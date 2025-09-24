/**
 * Unit tests for Protocol module
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { Protocol, MessageTypes } = require('../../protocol');

describe('Protocol', () => {
  let protocol;

  beforeEach(() => {
    protocol = new Protocol();
  });

  describe('message creation', () => {
    test('should create handshake message', () => {
      const handshake = protocol.createHandshake('testApp', {
        pools: ['alpha'],
        triggers: ['foo', 'bar'],
        meta: { version: '1.0.0' }
      });

      expect(handshake.action).toBe(MessageTypes.HANDSHAKE);
      expect(handshake.app_id).toBe('testApp');
      expect(handshake.pools).toEqual(['alpha']);
      expect(handshake.triggers).toEqual(['foo', 'bar']);
      expect(handshake.id).toBeDefined();
      expect(handshake.timestamp).toBeDefined();
    });

    test('should create trigger message', () => {
      const trigger = protocol.createTrigger('testProcess', { x: 1 }, {
        pool: 'alpha',
        destination: 'targetApp'
      });

      expect(trigger.action).toBe(MessageTypes.TRIGGER);
      expect(trigger.process).toBe('testProcess');
      expect(trigger.data).toEqual({ x: 1 });
      expect(trigger.pool).toBe('alpha');
      expect(trigger.destination).toBe('targetApp');
      expect(trigger.ttl).toBeDefined();
    });

    test('should create response message', () => {
      const originalMessage = { id: 'test-id' };
      const response = protocol.createResponse(originalMessage, { result: 'success' });

      expect(response.action).toBe(MessageTypes.RESPONSE);
      expect(response.in_reply_to).toBe('test-id');
      expect(response.status).toBe('ok');
      expect(response.response).toEqual({ result: 'success' });
    });
  });

  describe('message validation', () => {
    test('should validate correct handshake message', () => {
      const message = {
        action: MessageTypes.HANDSHAKE,
        app_id: 'testApp',
        pools: ['alpha'],
        triggers: ['foo']
      };

      expect(() => protocol.validateMessage(message)).not.toThrow();
    });

    test('should reject message without action', () => {
      const message = {
        app_id: 'testApp'
      };

      expect(() => protocol.validateMessage(message)).toThrow('Message must have an action field');
    });

    test('should reject handshake without app_id', () => {
      const message = {
        action: MessageTypes.HANDSHAKE,
        pools: ['alpha']
      };

      expect(() => protocol.validateMessage(message)).toThrow('Missing required field: app_id');
    });
  });

  describe('message parsing', () => {
    test('should parse JSON string message', () => {
      const messageObj = { action: 'test', id: '123' };
      const messageStr = JSON.stringify(messageObj);
      
      const parsed = protocol.parseMessage(messageStr);
      
      expect(parsed).toEqual(messageObj);
    });

    test('should parse Buffer message', () => {
      const messageObj = { action: 'test', id: '123' };
      const messageBuffer = Buffer.from(JSON.stringify(messageObj));
      
      const parsed = protocol.parseMessage(messageBuffer);
      
      expect(parsed).toEqual(messageObj);
    });

    test('should reject invalid JSON', () => {
      const invalidJson = '{ invalid json }';
      
      expect(() => protocol.parseMessage(invalidJson)).toThrow('Invalid JSON message');
    });
  });

  describe('routing information', () => {
    test('should extract routing information', () => {
      const message = {
        id: 'test-id',
        action: MessageTypes.TRIGGER,
        pool: 'alpha',
        process: 'foo',
        origin: { app_id: 'sourceApp' },
        destination: 'targetApp'
      };

      const routing = protocol.extractRouting(message);

      expect(routing.messageId).toBe('test-id');
      expect(routing.action).toBe(MessageTypes.TRIGGER);
      expect(routing.pool).toBe('alpha');
      expect(routing.process).toBe('foo');
      expect(routing.origin).toEqual({ app_id: 'sourceApp' });
      expect(routing.destination).toBe('targetApp');
    });

    test('should determine if message requires response', () => {
      const triggerMessage = { action: MessageTypes.TRIGGER };
      const emitMessage = { action: MessageTypes.EMIT };
      const responseMessage = { action: MessageTypes.RESPONSE };

      expect(protocol.requiresResponse(triggerMessage)).toBe(true);
      expect(protocol.requiresResponse(emitMessage)).toBe(false);
      expect(protocol.requiresResponse(responseMessage)).toBe(false);
    });
  });
});