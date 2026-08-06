import { Test, TestingModule } from '@nestjs/testing';
import { JwtTestService } from './jwt-test.service';

describe('JwtTestService', () => {
  let service: JwtTestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtTestService],
    }).compile();

    service = module.get<JwtTestService>(JwtTestService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
