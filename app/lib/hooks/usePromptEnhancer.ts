import { useState } from 'react';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = () => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (input: string, setInput: (value: string) => void, accessToken?: string) => {
    const originalInput = input;

    setEnhancingPrompt(true);
    setPromptEnhanced(false);

    try {
      if (!accessToken) {
        throw new Error('Missing auth session for prompt enhancement');
      }

      const response = await fetch('/api/enhancer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message: input,
        }),
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        throw new Error(`Enhancer request failed with status ${response.status}: ${responseText}`);
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('Enhancer response has no readable stream');
      }

      const decoder = new TextDecoder();
      let enhancedInput = '';

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        enhancedInput += decoder.decode(value);
        logger.trace('Set input', enhancedInput);
        setInput(enhancedInput);
      }

      if (enhancedInput.trim().length === 0) {
        setInput(originalInput);
        setPromptEnhanced(false);
        return;
      }

      setPromptEnhanced(true);
    } catch (error) {
      logger.error(error);
      setInput(originalInput);
      setPromptEnhanced(false);
    } finally {
      setEnhancingPrompt(false);
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
