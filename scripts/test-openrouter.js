const OpenAI = require('openai');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://localhost:3000',
    'X-Title': process.env.OPENROUTER_SITE_NAME || 'WhatsApp Agent Test'
  }
});

async function testOpenRouter() {
  try {
    console.log('🧪 Testing OpenRouter integration...');
    console.log(`📡 Using model: ${process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo'}`);
    
    const response = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: 'Hello! Can you write a short haiku about artificial intelligence?'
        }
      ],
      max_tokens: parseInt(process.env.OPENROUTER_MAX_TOKENS) || 100,
      temperature: parseFloat(process.env.OPENROUTER_TEMPERATURE) || 0.7
    });

    console.log('\n✅ OpenRouter Response:');
    console.log('─'.repeat(50));
    console.log(response.choices[0].message.content);
    console.log('─'.repeat(50));
    
    console.log('\n📊 Usage Statistics:');
    console.log(`• Prompt tokens: ${response.usage?.prompt_tokens || 'N/A'}`);
    console.log(`• Completion tokens: ${response.usage?.completion_tokens || 'N/A'}`);
    console.log(`• Total tokens: ${response.usage?.total_tokens || 'N/A'}`);
    console.log(`• Model used: ${response.model || 'N/A'}`);
    
    console.log('\n🎉 OpenRouter integration test successful!');
    
  } catch (error) {
    console.error('❌ OpenRouter test failed:', error.message);
    
    if (error.code === 'invalid_api_key') {
      console.error('\n💡 Please check your OPENROUTER_API_KEY in the .env file');
      console.error('   You can get an API key from: https://openrouter.ai/keys');
    } else if (error.code === 'insufficient_quota') {
      console.error('\n💡 Your OpenRouter account has insufficient credits');
      console.error('   Please add credits at: https://openrouter.ai/credits');
    } else {
      console.error('\n💡 Error details:', {
        status: error.status,
        code: error.code,
        type: error.type
      });
    }
  }
}

// Run the test
if (require.main === module) {
  testOpenRouter();
}

module.exports = { testOpenRouter };