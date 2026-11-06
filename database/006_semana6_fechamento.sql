-- Semana 6: fechamento do dia e números para análise (dia, semana, mês).
-- Rodar no Supabase: painel do projeto > SQL Editor > New query > colar e executar (depois do 005).
-- Pode ser rodado de novo sem perder dados.
--
-- Fechar o caixa: a pessoa conta o dinheiro da gaveta e o programa compara com o esperado
-- (troco inicial + vendas em dinheiro). Depois do fechamento não dá mais para vender nem cancelar venda
-- daquele dia. Só o gerente reabre um caixa fechado por engano (e só o de hoje).

-- ---------------------------------------------------------------- Colunas do fechamento
alter table public.caixas add column if not exists fechado_por uuid references public.perfis (id);
alter table public.caixas add column if not exists nome_fechado_por text;
alter table public.caixas add column if not exists dinheiro_contado numeric(10, 2)
    check (dinheiro_contado is null or dinheiro_contado between 0 and 1000000);
alter table public.caixas add column if not exists observacao_fechamento text
    check (observacao_fechamento is null or length(observacao_fechamento) <= 300);

-- ---------------------------------------------------------------- Funções

-- Fecha o caixa de hoje com o dinheiro contado na gaveta (gerente ou operador).
create or replace function public.fechar_caixa(p_dinheiro_contado numeric, p_observacao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_perfil public.perfis%rowtype;
    v_caixa public.caixas%rowtype;
begin
    select * into v_perfil from public.perfis where id = auth.uid() and ativo;
    if not found then
        raise exception 'Seu usuário não pode fechar o caixa.' using errcode = '42501';
    end if;
    select * into v_caixa from public.caixas where data = public.hoje_local() for update;
    if not found then
        raise exception 'O caixa de hoje não foi aberto: não há o que fechar.' using errcode = '22023';
    end if;
    if v_caixa.fechado_em is not null then
        raise exception 'O caixa de hoje já foi fechado por % às %.', v_caixa.nome_fechado_por,
            to_char(v_caixa.fechado_em at time zone 'America/Sao_Paulo', 'HH24:MI') using errcode = '22023';
    end if;
    if p_dinheiro_contado is null or p_dinheiro_contado < 0 or p_dinheiro_contado > 1000000 then
        raise exception 'Digite quanto dinheiro há na gaveta, por exemplo 350,00.' using errcode = '22023';
    end if;

    update public.caixas
       set fechado_em = now(), fechado_por = v_perfil.id, nome_fechado_por = v_perfil.nome,
           dinheiro_contado = round(p_dinheiro_contado, 2),
           observacao_fechamento = nullif(left(trim(p_observacao), 300), '')
     where id = v_caixa.id;
end;
$$;

-- Reabre o caixa de hoje fechado por engano (só o gerente).
create or replace function public.reabrir_caixa()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.eh_gerente() then
        raise exception 'Só o gerente pode reabrir o caixa.' using errcode = '42501';
    end if;
    update public.caixas
       set fechado_em = null, fechado_por = null, nome_fechado_por = null, dinheiro_contado = null, observacao_fechamento = null
     where data = public.hoje_local() and fechado_em is not null;
    if not found then
        raise exception 'O caixa de hoje não está fechado.' using errcode = '22023';
    end if;
end;
$$;

-- Vendas por dia (sem as canceladas), para o resumo do dia, da semana e do mês. Dias sem venda não aparecem.
-- Roda com o login de quem chamou (security invoker): as regras de leitura de vendas continuam valendo.
create or replace function public.vendas_por_dia(p_inicio date, p_fim date)
returns table (dia date, total numeric, quantidade bigint, dinheiro numeric, pix numeric, debito numeric, credito numeric)
language sql
stable
security invoker
set search_path = public
as $$
    select (v.criado_em at time zone 'America/Sao_Paulo')::date as dia,
           sum(v.total), count(*),
           coalesce(sum(v.total) filter (where v.forma = 'dinheiro'), 0),
           coalesce(sum(v.total) filter (where v.forma = 'pix'), 0),
           coalesce(sum(v.total) filter (where v.forma = 'debito'), 0),
           coalesce(sum(v.total) filter (where v.forma = 'credito'), 0)
      from public.vendas v
     where not v.cancelada
       and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
     group by 1
     order by 1;
$$;

-- Produtos que mais venderam no período (por valor), sem as vendas canceladas.
create or replace function public.mais_vendidos(p_inicio date, p_fim date, p_limite integer default 10)
returns table (nome_produto text, unidade_medida text, quantidade numeric, total numeric)
language sql
stable
security invoker
set search_path = public
as $$
    select i.nome_produto, i.unidade_medida, sum(i.quantidade), sum(i.subtotal)
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id
     where not v.cancelada
       and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim
     group by i.nome_produto, i.unidade_medida
     order by sum(i.subtotal) desc
     limit least(greatest(coalesce(p_limite, 10), 1), 50);
$$;

revoke execute on function public.fechar_caixa(numeric, text) from public, anon;
revoke execute on function public.reabrir_caixa() from public, anon;
revoke execute on function public.vendas_por_dia(date, date) from public, anon;
revoke execute on function public.mais_vendidos(date, date, integer) from public, anon;
grant execute on function public.fechar_caixa(numeric, text) to authenticated;
grant execute on function public.reabrir_caixa() to authenticated;
grant execute on function public.vendas_por_dia(date, date) to authenticated;
grant execute on function public.mais_vendidos(date, date, integer) to authenticated;
