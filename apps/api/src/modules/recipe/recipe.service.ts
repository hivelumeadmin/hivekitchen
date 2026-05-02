import type {
  RecipeFetchInput,
  RecipeFetchOutput,
  RecipeSearchInput,
  RecipeSearchOutput,
} from '@hivekitchen/types';
import { NotImplementedError } from '../../common/errors.js';

export class RecipeService {
  async search(_input: RecipeSearchInput): Promise<RecipeSearchOutput> {
    throw new NotImplementedError('recipe.search — real service is a future story');
  }

  async fetch(_input: RecipeFetchInput): Promise<RecipeFetchOutput> {
    throw new NotImplementedError('recipe.fetch — real service is a future story');
  }
}
