import swaggerJsdoc from 'swagger-jsdoc';

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, example) => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});
const success = (description, schema, example) => ({
  description,
  ...(schema ? { content: json(schema, example) } : {}),
});
const error = (description) => success(description, ref('ErrorResponse'));
const body = (schema, example) => ({
  required: true,
  content: json(ref(schema), example),
});
const pathParam = (name, example) => ({
  in: 'path', name, required: true, schema: { type: 'string' }, example,
});
const queryParam = (name, schema, description, example) => ({
  in: 'query', name, required: false, schema, description, example,
});
const protectedOperation = { security: [{ bearerAuth: [] }] };
const authErrors = { '401': error('Token ausente ou inválido.') };
const writeErrors = {
  ...authErrors,
  '400': error('Dados inválidos.'),
  '403': error('Operação não permitida.'),
  '500': error('Erro interno.'),
};

const schemas = {
  ErrorResponse: {
    type: 'object',
    properties: { error: { type: 'string', example: 'Invalid request.' } },
  },
  PublicUser: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'user-1' },
      name: { type: 'string', example: 'Ana Souza' },
      email: { type: 'string', format: 'email', example: 'ana@example.com' },
      role: { type: 'string', enum: ['user', 'admin'], example: 'user' },
    },
  },
  LoginResponse: {
    type: 'object',
    properties: {
      user: ref('PublicUser'),
      token: { type: 'string', description: 'JWT de acesso', example: 'eyJhbGciOiJIUzI1NiJ9...' },
    },
  },
  Place: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'place-1' },
      title: { type: 'string', example: 'Parque Ibirapuera' },
      description: { type: 'string', example: 'Parque urbano em São Paulo.' },
      category: { type: 'string', example: 'parque' },
      latitude: { type: 'number', minimum: -90, maximum: 90, example: -23.5874 },
      longitude: { type: 'number', minimum: -180, maximum: 180, example: -46.6576 },
      authorId: { type: 'string', example: 'user-1' },
      averageRating: { type: 'number', nullable: true, example: 4.5 },
    },
  },
  Review: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'review-1' },
      rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
      comment: { type: 'string', nullable: true, example: 'Ótimo lugar para passear.' },
      commentHidden: { type: 'boolean', example: true },
      userId: { type: 'string', example: 'user-1' },
      placeId: { type: 'string', example: 'place-1' },
      createdAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:30:00.000Z' },
      updatedAt: { type: 'string', format: 'date-time', example: '2026-01-15T10:30:00.000Z' },
    },
  },
  Itinerary: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'itinerary-1' },
      title: { type: 'string', example: 'Passeio pelo centro' },
      description: { type: 'string', example: 'Lugares para visitar no centro.' },
      ownerId: { type: 'string', example: 'user-1' },
      placeIds: { type: 'array', items: { type: 'string' }, example: ['place-1', 'place-2'] },
    },
  },
  RegisterRequest: {
    type: 'object', required: ['name', 'email', 'password'],
    properties: {
      name: { type: 'string', example: 'Ana Souza' },
      email: { type: 'string', format: 'email', example: 'ana@example.com' },
      password: { type: 'string', format: 'password', example: 'MinhaSenha123' },
    },
  },
  LoginRequest: {
    type: 'object', required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', example: 'ana@example.com' },
      password: { type: 'string', format: 'password', example: 'MinhaSenha123' },
    },
  },
  PlaceCreateRequest: {
    type: 'object', required: ['title', 'description', 'category', 'latitude', 'longitude'],
    properties: {
      title: { type: 'string', example: 'Parque Ibirapuera' },
      description: { type: 'string', example: 'Parque urbano em São Paulo.' },
      category: { type: 'string', example: 'parque' },
      latitude: { type: 'number', minimum: -90, maximum: 90, example: -23.5874 },
      longitude: { type: 'number', minimum: -180, maximum: 180, example: -46.6576 },
    },
  },
  PlaceUpdateRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', example: 'Parque Ibirapuera' },
      description: { type: 'string', example: 'Área verde na cidade.' },
      category: { type: 'string', example: 'parque' },
    },
  },
  ReviewUpsertRequest: {
    type: 'object', required: ['rating'],
    properties: {
      rating: { type: 'integer', minimum: 1, maximum: 5, example: 5 },
      comment: { type: 'string', example: 'Ótimo lugar para passear.' },
    },
  },
  ItineraryCreateRequest: {
    type: 'object', required: ['title', 'description'],
    properties: {
      title: { type: 'string', example: 'Passeio pelo centro' },
      description: { type: 'string', example: 'Lugares para visitar no centro.' },
      placeIds: { type: 'array', items: { type: 'string' }, example: ['place-1', 'place-2'] },
    },
  },
  ItineraryUpdateRequest: {
    type: 'object',
    properties: {
      title: { type: 'string', example: 'Passeio atualizado' },
      description: { type: 'string', example: 'Nova descrição.' },
    },
  },
  AddItineraryPlaceRequest: {
    type: 'object', required: ['placeId'],
    properties: { placeId: { type: 'string', example: 'place-1' } },
  },
  FavoriteCreateRequest: {
    type: 'object', required: ['placeId'],
    properties: { placeId: { type: 'string', example: 'place-1' } },
  },
  ReviewReportRequest: {
    type: 'object', required: ['targetType'],
    properties: {
      targetType: { type: 'string', enum: ['rating', 'comment'], example: 'comment' },
    },
  },
  ModerateReviewReportRequest: {
    type: 'object', required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['approve', 'reject'], example: 'approve' },
      contentAction: { type: 'string', enum: ['keep_hidden', 'restore'], example: 'keep_hidden' },
    },
  },
  ReviewReport: {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'report-1' },
      reviewId: { type: 'string', example: 'review-1' },
      targetType: { type: 'string', enum: ['rating', 'comment'], example: 'comment' },
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'], example: 'pending' },
      createdAt: { type: 'string', format: 'date-time' },
      activeReportCount: { type: 'integer', example: 4 },
      visibilityState: { type: 'string', enum: ['visible', 'auto_hidden', 'moderator_hidden'] },
    },
  },
};

const paths = {
  '/api/users/register': {
    post: {
      tags: ['Users'], summary: 'Cadastra um usuário',
      requestBody: body('RegisterRequest', { name: 'Ana Souza', email: 'ana@example.com', password: 'MinhaSenha123' }),
      responses: {
        '201': success('Usuário cadastrado; somente dados públicos são retornados.', ref('PublicUser')),
        '400': error('Dados inválidos.'), '409': error('E-mail já cadastrado.'), '500': error('Erro interno.'),
      },
    },
  },
  '/api/users/login': {
    post: {
      tags: ['Users'], summary: 'Autentica um usuário e retorna JWT',
      requestBody: body('LoginRequest', { email: 'ana@example.com', password: 'MinhaSenha123' }),
      responses: {
        '200': success('Autenticação concluída.', ref('LoginResponse')),
        '400': error('Dados inválidos.'), '401': error('Credenciais inválidas.'), '500': error('Erro interno.'),
      },
    },
  },
  '/api/places': {
    post: {
      ...protectedOperation, tags: ['Places'], summary: 'Cadastra lugar para o usuário autenticado',
      requestBody: body('PlaceCreateRequest', {
        title: 'Parque Ibirapuera', description: 'Parque urbano em São Paulo.', category: 'parque',
        latitude: -23.5874, longitude: -46.6576,
      }),
      responses: { '201': success('Lugar criado.', ref('Place')), ...writeErrors },
    },
    get: {
      tags: ['Places'], summary: 'Lista lugares',
      responses: {
        '200': success('Lista de lugares.', { type: 'array', items: ref('Place') }),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/places/category/{category}': {
    get: {
      tags: ['Places'], summary: 'Lista lugares por categoria', parameters: [pathParam('category', 'parque')],
      responses: {
        '200': success('Lugares da categoria; lista vazia quando não houver resultados.', { type: 'array', items: ref('Place') }),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/places/search': {
    get: {
      tags: ['Places'], summary: 'Busca lugares do catálogo por nome, categoria e proximidade',
      description: 'Nome e categoria podem ser combinados. Para proximidade, informe radiusKm e exatamente uma origem: latitude+longitude ou address. address é geocodificado no backend pela Google Geocoding API; os resultados permanecem limitados ao catálogo local do Rolemap. O raio deve ser positivo e não possui limite máximo definido pelo produto.',
      parameters: [
        queryParam('name', { type: 'string', minLength: 1 }, 'Busca parcial no título do lugar.', 'Parque'),
        queryParam('category', { type: 'string', minLength: 1 }, 'Filtra pela categoria existente.', 'natureza'),
        queryParam('latitude', { type: 'number', minimum: -90, maximum: 90 }, 'Origem para proximidade; exige longitude e radiusKm.', -23.55),
        queryParam('longitude', { type: 'number', minimum: -180, maximum: 180 }, 'Origem para proximidade; exige latitude e radiusKm.', -46.63),
        queryParam('radiusKm', { type: 'number', exclusiveMinimum: 0 }, 'Raio em quilômetros; exige coordenadas ou address.', 5),
        queryParam('address', { type: 'string', minLength: 1 }, 'Endereço usado como origem; não pode ser combinado com latitude/longitude e exige radiusKm.', 'Praça da Sé, São Paulo, SP'),
      ],
      responses: {
        '200': success('Lugares locais filtrados; buscas por proximidade são ordenadas pela distância crescente.', { type: 'array', items: ref('Place') }),
        '400': error('Filtros, origem, coordenadas ou raio inválidos; endereço sem resultado de geocodificação.'),
        '500': error('Erro interno ou falha da Google Geocoding API.'),
      },
    },
  },
  '/api/places/{id}': {
    get: {
      tags: ['Places'], summary: 'Consulta lugar por ID', parameters: [pathParam('id', 'place-1')],
      responses: {
        '200': success('Lugar encontrado.', ref('Place')),
        '404': error('Lugar não encontrado.'), '500': error('Erro interno.'),
      },
    },
    put: {
      ...protectedOperation, tags: ['Places'], summary: 'Atualiza título, descrição ou categoria do lugar',
      description: 'Coordenadas e autoria são preservadas. A autorização é verificada pelo serviço.',
      parameters: [pathParam('id', 'place-1')],
      requestBody: body('PlaceUpdateRequest', { title: 'Parque Ibirapuera', description: 'Área verde na cidade.', category: 'parque' }),
      responses: {
        '200': success('Resultado da atualização.', { type: 'boolean', example: true }),
        ...writeErrors, '404': error('Lugar não encontrado.'),
      },
    },
    delete: {
      ...protectedOperation, tags: ['Places'], summary: 'Exclui lugar', parameters: [pathParam('id', 'place-1')],
      responses: {
        '204': success('Lugar excluído; resposta sem corpo.'),
        ...writeErrors, '404': error('Lugar não encontrado.'),
      },
    },
  },
  '/api/reviews/places/{placeId}': {
    post: {
      ...protectedOperation, tags: ['Reviews'], summary: 'Cria ou atualiza a avaliação do usuário autenticado',
      description: 'Atende à regra de uma avaliação por usuário e lugar. Avaliação existente é atualizada.',
      parameters: [pathParam('placeId', 'place-1')],
      requestBody: body('ReviewUpsertRequest', { rating: 5, comment: 'Ótimo lugar para passear.' }),
      responses: {
        '201': success('Avaliação criada.', ref('Review')),
        '200': success('Avaliação existente atualizada.', ref('Review')),
        '400': error('Dados inválidos ou lugar inexistente.'), ...authErrors,
        '500': error('Erro interno.'),
      },
    },
    get: {
      tags: ['Reviews'], summary: 'Lista avaliações de um lugar', parameters: [pathParam('placeId', 'place-1')],
      responses: {
        '200': success('Lista de avaliações.', { type: 'array', items: ref('Review') }),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/reviews/{id}/reports': {
    post: {
      ...protectedOperation, tags: ['Reviews'], summary: 'Denuncia a nota ou comentário de uma avaliação',
      description: 'Uma mesma identidade pode denunciar uma vez cada alvo. A quarta denúncia válida de usuários distintos oculta automaticamente o alvo. reporterId é obtido do JWT.',
      parameters: [pathParam('id', 'review-1')],
      requestBody: body('ReviewReportRequest', { targetType: 'comment' }),
      responses: {
        '201': success('Denúncia registrada.', ref('ReviewReport')),
        '400': error('Alvo ou identificadores inválidos.'), '401': error('Token ausente ou inválido.'),
        '404': error('Avaliação não encontrada.'), '409': error('O usuário já denunciou esse alvo.'),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/reviews/moderation/reports': {
    get: {
      ...protectedOperation, tags: ['Review moderation'], summary: 'Lista denúncias pendentes para administradores',
      description: 'A autorização consulta o papel atual do usuário no SQLite; o papel do corpo da requisição ou de um JWT antigo não concede acesso.',
      responses: {
        '200': success('Fila de denúncias pendentes.', { type: 'array', items: { type: 'object' } }),
        '401': error('Token ausente ou inválido.'), '403': error('Somente administradores podem consultar a moderação.'),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/reviews/moderation/reports/{reportId}': {
    patch: {
      ...protectedOperation, tags: ['Review moderation'], summary: 'Aprova ou rejeita denúncia e define a ação sobre o conteúdo',
      description: 'keep_hidden cria ocultação manual, que permanece apesar da queda da contagem. restore remove a ocultação manual; se ainda houver quatro denúncias válidas, o alvo permanece auto-oculto.',
      parameters: [pathParam('reportId', 'report-1')],
      requestBody: body('ModerateReviewReportRequest', { decision: 'approve', contentAction: 'keep_hidden' }),
      responses: {
        '200': success('Denúncia moderada e visibilidade recalculada.', { type: 'object' }),
        '400': error('Decisão inválida ou denúncia já moderada.'), '401': error('Token ausente ou inválido.'),
        '403': error('Somente administradores podem moderar denúncias.'),
        '404': error('Denúncia não encontrada.'), '500': error('Erro interno.'),
      },
    },
  },
  '/api/reviews/users/{userId}': {
    get: {
      tags: ['Reviews'], summary: 'Lista avaliações de um usuário', parameters: [pathParam('userId', 'user-1')],
      responses: {
        '200': success('Lista de avaliações.', { type: 'array', items: ref('Review') }),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/reviews/{id}': {
    get: {
      tags: ['Reviews'], summary: 'Consulta avaliação por ID', parameters: [pathParam('id', 'review-1')],
      responses: {
        '200': success('Avaliação encontrada.', ref('Review')),
        '404': error('Avaliação não encontrada.'), '500': error('Erro interno.'),
      },
    },
    delete: {
      ...protectedOperation, tags: ['Reviews'], summary: 'Exclui avaliação conforme autorização do serviço',
      parameters: [pathParam('id', 'review-1')],
      responses: {
        '204': success('Avaliação excluída; resposta sem corpo.'),
        '400': error('ID inválido.'), '401': error('Token ausente ou inválido.'),
        '403': error('Operação não permitida.'), '404': error('Avaliação não encontrada.'),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/itineraries': {
    post: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Cria roteiro para o usuário autenticado',
      description: 'A identidade do proprietário vem do token; a ordem de placeIds é preservada.',
      requestBody: body('ItineraryCreateRequest', {
        title: 'Passeio pelo centro', description: 'Lugares para visitar no centro.', placeIds: ['place-1', 'place-2'],
      }),
      responses: {
        '201': success('Roteiro criado.', ref('Itinerary')),
        '400': error('Dados inválidos ou lugar inexistente.'), '409': error('O roteiro contém lugar duplicado.'),
        ...authErrors, '500': error('Erro interno.'),
      },
    },
    get: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Lista roteiros do usuário autenticado',
      responses: {
        '200': success('Lista dos roteiros próprios.', { type: 'array', items: ref('Itinerary') }),
        '400': error('Identidade inválida.'), ...authErrors, '500': error('Erro interno.'),
      },
    },
  },
  '/api/itineraries/{id}': {
    get: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Consulta roteiro próprio por ID',
      description: 'O acesso é restrito ao proprietário, inclusive para usuários administradores.',
      parameters: [pathParam('id', 'itinerary-1')],
      responses: {
        '200': success('Roteiro encontrado.', ref('Itinerary')),
        '400': error('Identidade inválida.'), '401': error('Token ausente ou inválido.'),
        '403': error('Roteiro pertence a outro usuário.'), '404': error('Roteiro não encontrado.'),
        '500': error('Erro interno.'),
      },
    },
    put: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Atualiza título ou descrição de roteiro próprio',
      parameters: [pathParam('id', 'itinerary-1')],
      requestBody: body('ItineraryUpdateRequest', { title: 'Passeio atualizado', description: 'Nova descrição.' }),
      responses: {
        '200': success('Resultado da atualização.', { type: 'boolean', example: true }),
        ...writeErrors, '404': error('Roteiro não encontrado.'),
      },
    },
    delete: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Exclui roteiro próprio',
      parameters: [pathParam('id', 'itinerary-1')],
      responses: {
        '204': success('Roteiro excluído; resposta sem corpo.'),
        ...writeErrors, '404': error('Roteiro não encontrado.'),
      },
    },
  },
  '/api/itineraries/{id}/places': {
    post: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Adiciona lugar a roteiro próprio',
      parameters: [pathParam('id', 'itinerary-1')],
      requestBody: body('AddItineraryPlaceRequest', { placeId: 'place-1' }),
      responses: {
        '200': success('Resultado da inclusão.', { type: 'boolean', example: true }),
        '400': error('ID inválido ou lugar inexistente.'), '401': error('Token ausente ou inválido.'),
        '403': error('Operação não permitida.'), '404': error('Roteiro não encontrado.'),
        '409': error('O lugar já está associado ao roteiro.'), '500': error('Erro interno.'),
      },
    },
  },
  '/api/itineraries/{id}/places/{placeId}': {
    delete: {
      ...protectedOperation, tags: ['Itineraries'], summary: 'Remove lugar de roteiro próprio',
      parameters: [pathParam('id', 'itinerary-1'), pathParam('placeId', 'place-1')],
      responses: {
        '204': success('Lugar removido; resposta sem corpo.'),
        '400': error('Identificadores inválidos.'), '401': error('Token ausente ou inválido.'),
        '403': error('Operação não permitida.'), '404': error('Roteiro ou associação não encontrada.'),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/favorites': {
    post: {
      ...protectedOperation, tags: ['Favorites'], summary: 'Adiciona lugar aos favoritos do usuário autenticado',
      description: 'placeId é enviado no corpo. A identidade é obtida do token, não do corpo.',
      requestBody: body('FavoriteCreateRequest', { placeId: 'place-1' }),
      responses: {
        '201': success('Favorito adicionado.', { type: 'boolean', example: true }),
        '200': success('Favorito já existia e não foi duplicado.', { type: 'boolean', example: false }),
        '400': error('placeId inválido.'), '401': error('Token ausente ou inválido.'),
        '404': error('Lugar não encontrado.'), '500': error('Erro interno.'),
      },
    },
    get: {
      ...protectedOperation, tags: ['Favorites'], summary: 'Lista IDs de lugares favoritos do usuário autenticado',
      responses: {
        '200': success('IDs em ordem determinística.', { type: 'array', items: { type: 'string' }, example: ['place-1', 'place-2'] }),
        '401': error('Token ausente ou inválido.'), '500': error('Erro interno.'),
      },
    },
  },
  '/api/favorites/{placeId}/check': {
    get: {
      ...protectedOperation, tags: ['Favorites'], summary: 'Verifica se o lugar está favoritado pelo usuário autenticado',
      description: 'Retorna false quando o vínculo não existe; a operação não verifica a existência do lugar.',
      parameters: [pathParam('placeId', 'place-1')],
      responses: {
        '200': success('Resultado da consulta.', { type: 'boolean', example: true }),
        '400': error('placeId inválido.'), '401': error('Token ausente ou inválido.'),
        '500': error('Erro interno.'),
      },
    },
  },
  '/api/favorites/{placeId}': {
    delete: {
      ...protectedOperation, tags: ['Favorites'], summary: 'Remove lugar dos favoritos do usuário autenticado',
      parameters: [pathParam('placeId', 'place-1')],
      responses: {
        '204': success('Favorito removido; resposta sem corpo.'),
        '400': error('placeId inválido.'), '401': error('Token ausente ou inválido.'),
        '403': error('Operação não permitida.'), '404': error('Favorito não encontrado.'),
        '500': error('Erro interno.'),
      },
    },
  },
};

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Rolemap API',
      version: '1.0.0',
      description: 'Documentação da API do Rolemap. JWT é fornecido pelo endpoint de login.',
    },
    servers: [{ url: '/', description: 'Servidor atual' }],
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths,
  },
  apis: [],
});

