-- Semana 5: caixa e vendas.
-- Rodar no Supabase: painel do projeto > SQL Editor > New query > colar e executar (depois do 001 ao 004).
-- Pode ser rodado de novo sem perder dados (só cria o que ainda não existe).
--
-- Um caixa por dia, aberto com o troco inicial. Enquanto a venda está aberta os itens ficam reservados no
-- programa e nada sai do estoque; só depois do pagamento a função registrar_venda dá baixa nos lotes (o que
-- vence primeiro sai primeiro). Lote vencido não pode ser vendido. Só o gerente cancela uma venda já paga
-- (os itens voltam para os mesmos lotes).
--
-- O operador não pode alterar lotes pelas regras do 003. Por isso abrir caixa, vender e cancelar só acontecem
-- pelas funções abaixo (security definer), que conferem quem chamou e cada quantidade antes de mexer no estoque.
-- As tabelas não têm regra de inserir/alterar: ninguém grava nelas direto.

-- ---------------------------------------------------------------- Ajudantes
-- Data de hoje no horário de Brasília (o banco roda em UTC; depois das 21h "current_date" já seria amanhã).
create or replace function public.hoje_local()
returns date
language sql
stable
as $$
    select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- Usuário logado com perfil ativo (gerente ou operador).
create or replace function public.usuario_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.perfis where id = auth.uid() and ativo);
$$;

-- ---------------------------------------------------------------- Tabelas
create table if not exists public.caixas (
    id               bigint generated always as identity primary key,
    data             date not null default public.hoje_local() unique,
    aberto_por       uuid not null references public.perfis (id),
    nome_aberto_por  text not null,
    aberto_em        timestamptz not null default now(),
    troco_inicial    numeric(10, 2) not null default 0 check (troco_inicial between 0 and 100000),
    -- Preenchidos no fechamento do dia (semana 6)
    fechado_em       timestamptz
);

create table if not exists public.vendas (
    id              bigint generated always as identity primary key,
    caixa_id        bigint not null references public.caixas (id) on delete restrict,
    operador        uuid not null references public.perfis (id),
    nome_operador   text not null,
    criado_em       timestamptz not null default now(),
    forma           text not null check (forma in ('dinheiro', 'pix', 'debito', 'credito')),
    total           numeric(10, 2) not null default 0 check (total >= 0),
    -- Só no dinheiro: quanto o cliente deu e o troco devolvido
    recebido        numeric(10, 2) check (recebido is null or recebido >= 0),
    troco           numeric(10, 2) not null default 0 check (troco >= 0),
    cancelada       boolean not null default false,
    cancelada_por   text,
    cancelada_em    timestamptz,
    check ((forma = 'dinheiro') = (recebido is not null)),
    check (cancelada = (cancelada_em is not null))
);

create index if not exists vendas_caixa on public.vendas (caixa_id);
create index if not exists vendas_criado_em on public.vendas (criado_em);

-- Itens vendidos. Nome, unidade e preço ficam guardados para o histórico continuar certo se o produto mudar.
create table if not exists public.venda_itens (
    id              bigint generated always as identity primary key,
    venda_id        bigint not null references public.vendas (id) on delete cascade,
    produto_id      bigint references public.produtos (id) on delete set null,
    nome_produto    text not null,
    unidade_medida  text not null check (unidade_medida in ('un', 'kg')),
    quantidade      numeric(12, 3) not null check (quantidade > 0),
    preco           numeric(10, 2) not null check (preco > 0),
    subtotal        numeric(10, 2) not null check (subtotal >= 0)
);

create index if not exists venda_itens_venda on public.venda_itens (venda_id);
create index if not exists venda_itens_produto on public.venda_itens (produto_id);

-- De quais lotes saiu cada item (para devolver aos mesmos lotes se a venda for cancelada).
create table if not exists public.venda_baixas (
    id             bigint generated always as identity primary key,
    venda_item_id  bigint not null references public.venda_itens (id) on delete cascade,
    lote_id        bigint references public.lotes (id) on delete set null,
    quantidade     numeric(12, 3) not null check (quantidade > 0)
);

create index if not exists venda_baixas_item on public.venda_baixas (venda_item_id);

-- ---------------------------------------------------------------- Regras de acesso (RLS)
-- Gerente e operador (ativos) leem o caixa e as vendas; gravar, só pelas funções.
alter table public.caixas enable row level security;
alter table public.vendas enable row level security;
alter table public.venda_itens enable row level security;
alter table public.venda_baixas enable row level security;

drop policy if exists "usuario ativo le caixas" on public.caixas;
create policy "usuario ativo le caixas"
    on public.caixas for select
    to authenticated
    using (public.usuario_ativo());

drop policy if exists "usuario ativo le vendas" on public.vendas;
create policy "usuario ativo le vendas"
    on public.vendas for select
    to authenticated
    using (public.usuario_ativo());

drop policy if exists "usuario ativo le itens de venda" on public.venda_itens;
create policy "usuario ativo le itens de venda"
    on public.venda_itens for select
    to authenticated
    using (public.usuario_ativo());

drop policy if exists "gerente le baixas de venda" on public.venda_baixas;
create policy "gerente le baixas de venda"
    on public.venda_baixas for select
    to authenticated
    using (public.eh_gerente());

-- ---------------------------------------------------------------- Funções (tudo ou nada)

-- Abre o caixa de hoje com o troco que está na gaveta. Devolve o id do caixa.
create or replace function public.abrir_caixa(p_troco_inicial numeric)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_perfil public.perfis%rowtype;
    v_caixa public.caixas%rowtype;
    v_id bigint;
begin
    select * into v_perfil from public.perfis where id = auth.uid() and ativo;
    if not found then
        raise exception 'Seu usuário não pode abrir o caixa.' using errcode = '42501';
    end if;
    if p_troco_inicial is null or p_troco_inicial < 0 or p_troco_inicial > 100000 then
        raise exception 'Digite um troco inicial válido, por exemplo 150,00.' using errcode = '22023';
    end if;

    select * into v_caixa from public.caixas where data = public.hoje_local();
    if found then
        raise exception 'O caixa de hoje já foi aberto por % às %.', v_caixa.nome_aberto_por,
            to_char(v_caixa.aberto_em at time zone 'America/Sao_Paulo', 'HH24:MI') using errcode = '22023';
    end if;

    insert into public.caixas (aberto_por, nome_aberto_por, troco_inicial)
    values (v_perfil.id, v_perfil.nome, round(p_troco_inicial, 2))
    returning id into v_id;
    return v_id;
end;
$$;

-- Registra a venda paga e dá baixa nos lotes. itens = [{"produto_id": 1, "quantidade": 2}, ...]
-- O preço vem do cadastro (não do programa). Devolve {"id": 12, "total": 25.90, "troco": 4.10}.
create or replace function public.registrar_venda(p_forma text, p_recebido numeric, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_perfil public.perfis%rowtype;
    v_caixa public.caixas%rowtype;
    v_venda bigint;
    v_item jsonb;
    v_produto public.produtos%rowtype;
    v_qtd numeric;
    v_vendavel numeric;
    v_vencido numeric;
    v_falta numeric;
    v_sai numeric;
    v_lote record;
    v_item_id bigint;
    v_subtotal numeric;
    v_total numeric := 0;
    v_recebido numeric;
begin
    select * into v_perfil from public.perfis where id = auth.uid() and ativo;
    if not found then
        raise exception 'Seu usuário não pode registrar vendas.' using errcode = '42501';
    end if;
    select * into v_caixa from public.caixas where data = public.hoje_local();
    if not found then
        raise exception 'O caixa de hoje ainda não foi aberto.' using errcode = '22023';
    end if;
    if v_caixa.fechado_em is not null then
        raise exception 'O caixa de hoje já foi fechado. Não dá para vender depois do fechamento.' using errcode = '22023';
    end if;
    if p_forma is null or p_forma not in ('dinheiro', 'pix', 'debito', 'credito') then
        raise exception 'Escolha a forma de pagamento.' using errcode = '22023';
    end if;
    if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
        raise exception 'Adicione pelo menos um produto à venda.' using errcode = '22023';
    end if;

    insert into public.vendas (caixa_id, operador, nome_operador, forma, recebido)
    values (v_caixa.id, v_perfil.id, v_perfil.nome, p_forma, case when p_forma = 'dinheiro' then 0 end)
    returning id into v_venda;

    for v_item in select * from jsonb_array_elements(p_itens) loop
        -- Trava o produto para duas vendas ao mesmo tempo não tirarem o mesmo lote
        select * into v_produto from public.produtos where id = (v_item ->> 'produto_id')::bigint for update;
        if not found then
            raise exception 'Um dos produtos da venda não existe mais. Tire-o e passe de novo.' using errcode = '22023';
        end if;
        v_qtd := round((v_item ->> 'quantidade')::numeric, 3);
        if v_qtd is null or v_qtd <= 0 or (v_produto.unidade_medida = 'un' and v_qtd <> trunc(v_qtd)) then
            raise exception '%: quantidade inválida.', v_produto.nome using errcode = '22023';
        end if;

        select coalesce(sum(quantidade_restante) filter (where validade is null or validade >= public.hoje_local()), 0),
               coalesce(sum(quantidade_restante) filter (where validade < public.hoje_local()), 0)
          into v_vendavel, v_vencido
          from public.lotes where produto_id = v_produto.id and quantidade_restante > 0;
        if v_vendavel < v_qtd then
            if v_vendavel = 0 and v_vencido > 0 then
                raise exception '%: só há lote vencido. A venda está bloqueada; retire o produto da prateleira.', v_produto.nome
                    using errcode = '22023';
            end if;
            raise exception '%: só há % disponível.', v_produto.nome,
                replace(rtrim(rtrim(to_char(v_vendavel, 'FM999999990.000'), '0'), '.'), '.', ',')
                    || case when v_produto.unidade_medida = 'kg' then ' kg' else ' un.' end
                using errcode = '22023';
        end if;

        v_subtotal := round(v_qtd * v_produto.preco, 2);
        insert into public.venda_itens (venda_id, produto_id, nome_produto, unidade_medida, quantidade, preco, subtotal)
        values (v_venda, v_produto.id, v_produto.nome, v_produto.unidade_medida, v_qtd, v_produto.preco, v_subtotal)
        returning id into v_item_id;
        v_total := v_total + v_subtotal;

        -- O lote que vence primeiro sai primeiro (sem validade por último)
        v_falta := v_qtd;
        for v_lote in
            select id, quantidade_restante from public.lotes
             where produto_id = v_produto.id and quantidade_restante > 0
               and (validade is null or validade >= public.hoje_local())
             order by validade nulls last, data_compra, id
        loop
            exit when v_falta <= 0;
            v_sai := least(v_falta, v_lote.quantidade_restante);
            update public.lotes set quantidade_restante = quantidade_restante - v_sai where id = v_lote.id;
            insert into public.venda_baixas (venda_item_id, lote_id, quantidade) values (v_item_id, v_lote.id, v_sai);
            v_falta := v_falta - v_sai;
        end loop;
    end loop;

    if p_forma = 'dinheiro' then
        -- Vazio = o cliente pagou o valor exato
        v_recebido := coalesce(round(p_recebido, 2), v_total);
        if v_recebido < v_total then
            raise exception 'O valor recebido é menor que o total (R$ %).', replace(to_char(v_total, 'FM999999990.00'), '.', ',')
                using errcode = '22023';
        end if;
    end if;

    update public.vendas
       set total = v_total, recebido = v_recebido, troco = coalesce(v_recebido - v_total, 0)
     where id = v_venda;

    return jsonb_build_object('id', v_venda, 'total', v_total, 'troco', coalesce(v_recebido - v_total, 0));
end;
$$;

-- Cancela uma venda paga do caixa de hoje (só o gerente). Os itens voltam para os mesmos lotes.
create or replace function public.cancelar_venda(p_venda_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_perfil public.perfis%rowtype;
    v_venda public.vendas%rowtype;
    v_caixa public.caixas%rowtype;
    v_baixa record;
begin
    select * into v_perfil from public.perfis where id = auth.uid() and ativo and perfil = 'gerente';
    if not found then
        raise exception 'Só o gerente pode cancelar uma venda já paga.' using errcode = '42501';
    end if;
    select * into v_venda from public.vendas where id = p_venda_id for update;
    if not found then
        raise exception 'Esta venda não existe mais.' using errcode = '22023';
    end if;
    if v_venda.cancelada then
        raise exception 'A venda nº % já foi cancelada.', v_venda.id using errcode = '22023';
    end if;
    select * into v_caixa from public.caixas where id = v_venda.caixa_id;
    if v_caixa.fechado_em is not null then
        raise exception 'O caixa deste dia já foi fechado. A venda não pode mais ser cancelada.' using errcode = '22023';
    end if;

    for v_baixa in
        select b.lote_id, b.quantidade from public.venda_baixas b
          join public.venda_itens i on i.id = b.venda_item_id
         where i.venda_id = v_venda.id and b.lote_id is not null
    loop
        update public.lotes set quantidade_restante = least(quantidade_inicial, quantidade_restante + v_baixa.quantidade)
         where id = v_baixa.lote_id;
    end loop;

    update public.vendas set cancelada = true, cancelada_por = v_perfil.nome, cancelada_em = now() where id = v_venda.id;
end;
$$;

-- Só quem entrou no sistema chama as funções
revoke execute on function public.abrir_caixa(numeric) from public, anon;
revoke execute on function public.registrar_venda(text, numeric, jsonb) from public, anon;
revoke execute on function public.cancelar_venda(bigint) from public, anon;
grant execute on function public.abrir_caixa(numeric) to authenticated;
grant execute on function public.registrar_venda(text, numeric, jsonb) to authenticated;
grant execute on function public.cancelar_venda(bigint) to authenticated;
