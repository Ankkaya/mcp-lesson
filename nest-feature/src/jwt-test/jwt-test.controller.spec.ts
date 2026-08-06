import { Test, TestingModule } from '@nestjs/testing';
import { JwtTestController } from './jwt-test.controller';
import { JwtTestService } from './jwt-test.service';

describe('JwtTestController', () => {
  let controller: JwtTestController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JwtTestController],
      providers: [JwtTestService],
    }).compile();

    controller = module.get<JwtTestController>(JwtTestController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
